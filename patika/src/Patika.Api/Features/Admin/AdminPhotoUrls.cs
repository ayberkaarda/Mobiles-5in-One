using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Patika.Contracts.Media;
using Patika.Infrastructure.Media;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Admin;

/// <summary>Private, two-minute links for processed queue photos. Raw incoming objects are deleted by the worker.</summary>
public sealed class AdminPhotoUrls : IDisposable
{
    private readonly AmazonS3Client? client;
    private readonly StorageSettings storage;
    private readonly TimeProvider clock;

    public AdminPhotoUrls(IOptions<StorageSettings> options, TimeProvider clock)
    {
        storage = options.Value;
        this.clock = clock;
        if (storage.Endpoint is null || storage.AccessKey is null || storage.SecretKey is null) return;
        client = new AmazonS3Client(new BasicAWSCredentials(storage.AccessKey, storage.SecretKey), new AmazonS3Config
        {
            ServiceURL = storage.PublicEndpoint ?? storage.Endpoint,
            ForcePathStyle = true,
            AuthenticationRegion = storage.Region,
        });
    }

    public Task<bool> IsProcessedAsync(PatikaDbContext db, string key, CancellationToken ct) =>
        MediaKeys.TryParse(key, out _, out _)
            ? db.Uploads.AnyAsync(u => u.Key == key && u.State == "Ready" && u.ProcessedAt != null, ct)
            : Task.FromResult(false);

    public async Task<string?> ResolveAsync(PatikaDbContext db, string key, CancellationToken ct)
    {
        if (client is null || !await IsProcessedAsync(db, key, ct)) return null;
        return await client.GetPreSignedURLAsync(new GetPreSignedUrlRequest
        {
            BucketName = storage.Bucket,
            Key = MediaKeys.Rendition(key, null),
            Verb = HttpVerb.GET,
            Expires = clock.GetUtcNow().AddMinutes(2).UtcDateTime,
        });
    }

    public void Dispose() => client?.Dispose();
}
