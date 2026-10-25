using Microsoft.Extensions.Logging.Abstractions;
using Patika.Contracts.Media;
using Patika.Worker.Jobs.Media;
using SkiaSharp;
using Xunit;

namespace Patika.Worker.Tests;

public sealed class MediaProcessorTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private readonly InMemoryObjectStore storage = new();
    private readonly InMemoryUploadStates uploads = new();

    private MediaProcessor Processor() =>
        new(storage, uploads, new FixedClock(DateTimeOffset.UtcNow), NullLogger<MediaProcessor>.Instance);

    private string Upload(byte[] content, string storedType, string declaredType, long? declaredLength = null)
    {
        var photoKey = MediaKeys.PhotoKey("urgent", Guid.CreateVersion7());
        uploads.Records[photoKey] = new UploadRecord(Guid.CreateVersion7(), declaredType, declaredLength ?? content.Length, UploadStates.Pending);
        storage.Add(MediaKeys.Incoming(photoKey), content, storedType);
        return photoKey;
    }

    [Fact]
    public async Task ValidJpegBecomesThreeCleanWebpRenditionsAndLeavesIncoming()
    {
        var key = Upload(TestImages.JpegWithGps(), "image/jpeg", "image/jpeg");

        Assert.Equal(MediaOutcome.Ready, await Processor().ProcessAsync(MediaKeys.Incoming(key), Ct));

        Assert.False(storage.Objects.ContainsKey(MediaKeys.Incoming(key)));
        foreach (var width in new int?[] { null, 800, 320 })
        {
            var stored = storage.Objects[MediaKeys.Rendition(key, width)];
            Assert.Equal("image/webp", stored.ContentType);
            Assert.False(TestImages.Contains(stored.Content, "Exif"));
            Assert.False(TestImages.Contains(stored.Content, TestImages.DescriptionMarker));
            Assert.False(ImageSanitizer.HasMetadataChunk(stored.Content));
        }

        Assert.Equal(UploadStates.Ready, uploads.Records[key].State);
    }

    [Fact]
    public async Task HtmlDeclaredAsJpegIsQuarantinedUntouched()
    {
        var html = TestImages.Html();
        var key = Upload(html, "image/jpeg", "image/jpeg");

        Assert.Equal(MediaOutcome.Quarantined, await Processor().ProcessAsync(MediaKeys.Incoming(key), Ct));

        Assert.False(storage.Objects.ContainsKey(MediaKeys.Incoming(key)));
        Assert.False(storage.Objects.ContainsKey(MediaKeys.Rendition(key, null)));
        Assert.Equal(html, storage.Objects[MediaKeys.Quarantine(key)].Content);
        Assert.Equal(UploadStates.Quarantined, uploads.Records[key].State);
        Assert.Equal(SanitizeFailures.UnknownSignature, uploads.Failures[key]);
    }

    [Theory]
    [InlineData("image/png", "image/jpeg", 0, SanitizeFailures.TypeMismatch)]
    [InlineData("image/jpeg", "image/jpeg", 1, SanitizeFailures.LengthMismatch)]
    public async Task StoredObjectMustMatchWhatWasPresigned(string storedType, string declaredType, int lengthDelta, string expected)
    {
        var jpeg = TestImages.JpegWithGps(64, 64);
        var key = Upload(jpeg, storedType, declaredType, jpeg.Length + lengthDelta);

        Assert.Equal(MediaOutcome.Quarantined, await Processor().ProcessAsync(MediaKeys.Incoming(key), Ct));
        Assert.Equal(expected, uploads.Failures[key]);
    }

    [Fact]
    public async Task UnknownUploadsAndForeignKeysAreQuarantined()
    {
        var orphan = MediaKeys.PhotoKey("station", Guid.CreateVersion7());
        storage.Add(MediaKeys.Incoming(orphan), TestImages.Png(), "image/png");
        storage.Add("incoming/../../etc/passwd", TestImages.Html(), "image/png");

        Assert.Equal(MediaOutcome.Quarantined, await Processor().ProcessAsync(MediaKeys.Incoming(orphan), Ct));
        Assert.Equal(MediaOutcome.Quarantined, await Processor().ProcessAsync("incoming/../../etc/passwd", Ct));

        Assert.DoesNotContain(storage.Objects.Keys, k => k.StartsWith(MediaKeys.IncomingPrefix, StringComparison.Ordinal));
        Assert.DoesNotContain(storage.Objects.Keys, k => k.StartsWith(MediaKeys.MediaPrefix, StringComparison.Ordinal));
        Assert.Equal(2, storage.Objects.Keys.Count(k => k.StartsWith(MediaKeys.QuarantinePrefix, StringComparison.Ordinal)));
    }
}
