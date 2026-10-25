using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace Patika.Api.Features.Media;

public interface IUploadPresigner
{
    /// <summary>A PUT URL whose signature binds the object key, <c>Content-Type</c> and <c>Content-Length</c>.</summary>
    Task<Uri> PresignPutAsync(string objectKey, string contentType, long contentLength, DateTimeOffset expiresAt);
}

/// <summary>
/// SigV4 query presigning with AWSSDK.S3. Presigning is a local computation (no network call); the
/// client is built for the public endpoint because the signature covers the host header.
/// </summary>
public sealed class S3UploadPresigner : IUploadPresigner, IDisposable
{
    private readonly AmazonS3Client client;
    private readonly string bucket;
    private readonly Protocol protocol;

    public S3UploadPresigner(IOptions<StorageSettings> options)
    {
        var settings = options.Value;
        var endpoint = settings.PublicEndpoint ?? settings.Endpoint
            ?? throw new InvalidOperationException("Storage:Endpoint is not configured.");
        var endpointUri = new Uri(endpoint, UriKind.Absolute);
        protocol = endpointUri.Scheme == Uri.UriSchemeHttp ? Protocol.HTTP : Protocol.HTTPS;
        bucket = settings.Bucket;
        var credentials = new BasicAWSCredentials(
            settings.AccessKey ?? throw new InvalidOperationException("Storage:AccessKey is not configured."),
            settings.SecretKey ?? throw new InvalidOperationException("Storage:SecretKey is not configured."));
        client = new AmazonS3Client(credentials, new AmazonS3Config
        {
            ServiceURL = endpointUri.GetLeftPart(UriPartial.Authority),
            ForcePathStyle = true,
            AuthenticationRegion = settings.Region,
            UseHttp = protocol == Protocol.HTTP,
        });
    }

    public async Task<Uri> PresignPutAsync(string objectKey, string contentType, long contentLength, DateTimeOffset expiresAt)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = bucket,
            Key = objectKey,
            Verb = HttpVerb.PUT,
            Protocol = protocol,
            ContentType = contentType,
            Expires = expiresAt.UtcDateTime,
        };
        request.Headers.ContentLength = contentLength;
        return new Uri(await client.GetPreSignedURLAsync(request), UriKind.Absolute);
    }

    public void Dispose() => client.Dispose();
}
