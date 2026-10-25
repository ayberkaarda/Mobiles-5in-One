using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace Patika.Worker.Jobs.Media;

/// <summary>S3-compatible storage settings, shared with the API (<c>Storage</c> section).</summary>
public sealed class WorkerStorageSettings
{
    public const string SectionName = "Storage";

    public string? Endpoint { get; set; }

    public string Bucket { get; set; } = "patika-local";

    public string? AccessKey { get; set; }

    public string? SecretKey { get; set; }

    public string Region { get; set; } = "us-east-1";
}

public sealed record StoredObject(byte[] Content, string? ContentType, long Length);

public interface IObjectStore
{
    Task<IReadOnlyList<string>> ListAsync(string prefix, int max, CancellationToken cancellationToken);

    Task<long?> GetLengthAsync(string key, CancellationToken cancellationToken);

    /// <summary>Reads the object; callers check the length first so oversized bodies are never buffered.</summary>
    Task<StoredObject?> GetAsync(string key, CancellationToken cancellationToken);

    Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken);

    Task CopyAsync(string sourceKey, string destinationKey, CancellationToken cancellationToken);

    Task DeleteAsync(string key, CancellationToken cancellationToken);
}

public sealed class S3ObjectStore : IObjectStore, IDisposable
{
    private readonly AmazonS3Client client;
    private readonly string bucket;

    public S3ObjectStore(IOptions<WorkerStorageSettings> options)
    {
        var settings = options.Value;
        var endpoint = new Uri(settings.Endpoint ?? throw new InvalidOperationException("Storage:Endpoint is not configured."));
        bucket = settings.Bucket;
        client = new AmazonS3Client(
            new BasicAWSCredentials(
                settings.AccessKey ?? throw new InvalidOperationException("Storage:AccessKey is not configured."),
                settings.SecretKey ?? throw new InvalidOperationException("Storage:SecretKey is not configured.")),
            new AmazonS3Config
            {
                ServiceURL = endpoint.GetLeftPart(UriPartial.Authority),
                ForcePathStyle = true,
                AuthenticationRegion = settings.Region,
                UseHttp = endpoint.Scheme == Uri.UriSchemeHttp,
                // R2 and MinIO do not need SDK-side trailing checksums; only send them when an API requires one.
                RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
                ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
            });
    }

    public async Task<IReadOnlyList<string>> ListAsync(string prefix, int max, CancellationToken cancellationToken)
    {
        var response = await client.ListObjectsV2Async(
            new ListObjectsV2Request { BucketName = bucket, Prefix = prefix, MaxKeys = max }, cancellationToken);
        return [.. (response.S3Objects ?? []).Select(o => o.Key)];
    }

    public async Task<long?> GetLengthAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            var metadata = await client.GetObjectMetadataAsync(bucket, key, cancellationToken);
            return metadata.ContentLength;
        }
        catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<StoredObject?> GetAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await client.GetObjectAsync(bucket, key, cancellationToken);
            using var buffer = new MemoryStream();
            await response.ResponseStream.CopyToAsync(buffer, cancellationToken);
            return new StoredObject(buffer.ToArray(), response.Headers.ContentType, response.ContentLength);
        }
        catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken)
    {
        using var stream = new MemoryStream(content, writable: false);
        await client.PutObjectAsync(new PutObjectRequest
        {
            BucketName = bucket,
            Key = key,
            InputStream = stream,
            ContentType = contentType,
            AutoCloseStream = false,
        }, cancellationToken);
    }

    public Task CopyAsync(string sourceKey, string destinationKey, CancellationToken cancellationToken) =>
        client.CopyObjectAsync(bucket, sourceKey, bucket, destinationKey, cancellationToken);

    public Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        client.DeleteObjectAsync(bucket, key, cancellationToken);

    public void Dispose() => client.Dispose();
}
