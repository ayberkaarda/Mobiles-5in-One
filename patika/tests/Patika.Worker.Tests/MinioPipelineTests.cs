using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Patika.Contracts.Media;
using Patika.Worker.Jobs.Media;
using Xunit;

namespace Patika.Worker.Tests;

/// <summary>The media job against a real S3-compatible store (MinIO container, random host port).</summary>
public sealed class MinioPipelineTests(MinioFixture minio) : IClassFixture<MinioFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task StoredRenditionsCarryNoExifAndBadBytesLandInQuarantine()
    {
        using var storage = new S3ObjectStore(Options.Create(new WorkerStorageSettings
        {
            Endpoint = minio.Endpoint,
            Bucket = MinioFixture.Bucket,
            AccessKey = minio.AccessKey,
            SecretKey = minio.SecretKey,
        }));
        var uploads = new InMemoryUploadStates();
        var jpeg = TestImages.JpegWithGps();
        var html = TestImages.Html();
        var good = MediaKeys.PhotoKey("animal", Guid.CreateVersion7());
        var spoof = MediaKeys.PhotoKey("animal", Guid.CreateVersion7());
        uploads.Records[good] = new UploadRecord(Guid.CreateVersion7(), "image/jpeg", jpeg.Length, UploadStates.Pending);
        uploads.Records[spoof] = new UploadRecord(Guid.CreateVersion7(), "image/jpeg", html.Length, UploadStates.Pending);
        await storage.PutAsync(MediaKeys.Incoming(good), jpeg, "image/jpeg", Ct);
        await storage.PutAsync(MediaKeys.Incoming(spoof), html, "image/jpeg", Ct);
        var processor = new MediaProcessor(storage, uploads, TimeProvider.System, NullLogger<MediaProcessor>.Instance);
        var job = new MediaProcessJob(storage, processor, NullLogger<MediaProcessJob>.Instance);

        await job.RunOnceAsync(Ct);

        Assert.Empty(await storage.ListAsync(MediaKeys.IncomingPrefix, 10, Ct));
        foreach (var width in new int?[] { null, 800, 320 })
        {
            var stored = await storage.GetAsync(MediaKeys.Rendition(good, width), Ct);
            Assert.NotNull(stored);
            Assert.Equal("image/webp", stored.ContentType);
            Assert.False(TestImages.Contains(stored.Content, "Exif"));
            Assert.False(TestImages.Contains(stored.Content, "EXIF"));
            Assert.False(TestImages.Contains(stored.Content, TestImages.DescriptionMarker));
            Assert.False(TestImages.Contains(stored.Content, TestImages.CameraMarker));
        }

        Assert.Equal(html, (await storage.GetAsync(MediaKeys.Quarantine(spoof), Ct))!.Content);
        Assert.Null(await storage.GetAsync(MediaKeys.Rendition(spoof, null), Ct));
        Assert.Equal(UploadStates.Ready, uploads.Records[good].State);
        Assert.Equal(UploadStates.Quarantined, uploads.Records[spoof].State);
    }
}
