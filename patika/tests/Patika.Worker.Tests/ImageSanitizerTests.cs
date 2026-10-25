using Patika.Worker.Jobs.Media;
using SkiaSharp;
using Xunit;

namespace Patika.Worker.Tests;

public sealed class ImageSanitizerTests
{
    private const long Max = 5 * 1024 * 1024;

    [Fact]
    public void JpegWithGpsExifComesOutAsWebpWithNoMetadataBytes()
    {
        var input = TestImages.JpegWithGps();
        // The fixture really carries the data the pipeline must remove, and still decodes.
        Assert.True(TestImages.Contains(input, "Exif\0\0"));
        Assert.True(TestImages.Contains(input, TestImages.DescriptionMarker));
        Assert.True(TestImages.Contains(input, TestImages.CameraMarker));
        Assert.Equal((2400, 1800, SKEncodedImageFormat.Jpeg), TestImages.Identify(input));

        var result = ImageSanitizer.Sanitize(input, "image/jpeg", Max);

        Assert.True(result.Succeeded, result.FailureCode);
        var image = result.Image!;
        foreach (var output in new[] { image.Full, image.Medium, image.Small })
        {
            Assert.True(TestImages.Contains(output, "RIFF") && TestImages.Contains(output, "WEBP"));
            Assert.False(TestImages.Contains(output, "Exif"));
            Assert.False(TestImages.Contains(output, "EXIF"));
            Assert.False(TestImages.Contains(output, "XMP "));
            Assert.False(TestImages.Contains(output, "ICCP"));
            Assert.False(TestImages.Contains(output, TestImages.DescriptionMarker));
            Assert.False(TestImages.Contains(output, TestImages.CameraMarker));
            Assert.False(ImageSanitizer.HasMetadataChunk(output));
            Assert.Equal(SKEncodedImageFormat.Webp, TestImages.Identify(output).Format);
        }
    }

    [Fact]
    public void RenditionsAreCappedAt1600And800And320()
    {
        var image = ImageSanitizer.Sanitize(TestImages.JpegWithGps(2400, 1800), "image/jpeg", Max).Image!;

        Assert.Equal((1600, 1200), (image.Width, image.Height));
        Assert.Equal((1600, 1200), TestImages.Size(image.Full));
        Assert.Equal((800, 600), TestImages.Size(image.Medium));
        Assert.Equal((320, 240), TestImages.Size(image.Small));
    }

    [Fact]
    public void ExifOrientationIsAppliedBeforeTheMetadataIsDropped()
    {
        // Orientation 6 (RightTop): the stored 400x200 pixels display as 200x400.
        var image = ImageSanitizer.Sanitize(TestImages.JpegWithGps(400, 200, orientation: 6), "image/jpeg", Max).Image!;

        Assert.Equal((200, 400), (image.Width, image.Height));
        Assert.Equal((200, 400), TestImages.Size(image.Full));
    }

    [Fact]
    public void SmallImagesAreNotUpscaled()
    {
        var result = ImageSanitizer.Sanitize(TestImages.Png(64, 48), "image/png", Max);

        Assert.True(result.Succeeded);
        Assert.Equal((64, 48), (result.Image!.Width, result.Image.Height));
        Assert.Equal(64, TestImages.Identify(result.Image.Small).Width);
    }

    [Fact]
    public void MagicBytesDecideTheTypeNotTheDeclaration()
    {
        Assert.Equal(SanitizeFailures.UnknownSignature, ImageSanitizer.Sanitize(TestImages.Html(), "image/jpeg", Max).FailureCode);
        Assert.Equal(SanitizeFailures.TypeMismatch, ImageSanitizer.Sanitize(TestImages.Png(), "image/jpeg", Max).FailureCode);
        Assert.Equal(SanitizeFailures.TypeMismatch, ImageSanitizer.Sanitize(TestImages.JpegWithGps(32, 32), "image/webp", Max).FailureCode);
        Assert.Equal("image/jpeg", ImageSanitizer.SniffContentType(TestImages.JpegWithGps(16, 16)));
        Assert.Equal("image/png", ImageSanitizer.SniffContentType(TestImages.Png()));
        Assert.Equal("image/webp", ImageSanitizer.SniffContentType("RIFF\0\0\0\0WEBPVP8 "u8));
        Assert.Null(ImageSanitizer.SniffContentType("GIF89a"u8));
    }

    [Fact]
    public void TruncatedEmptyOversizedAndHugeInputsFail()
    {
        var jpeg = TestImages.JpegWithGps(200, 200);
        Assert.Equal(SanitizeFailures.DecodeFailed, ImageSanitizer.Sanitize(jpeg[..(jpeg.Length / 2)], "image/jpeg", Max).FailureCode);
        Assert.Equal(SanitizeFailures.Empty, ImageSanitizer.Sanitize([], "image/jpeg", Max).FailureCode);
        Assert.Equal(SanitizeFailures.TooLarge, ImageSanitizer.Sanitize(jpeg, "image/jpeg", jpeg.Length - 1).FailureCode);
        Assert.Equal(SanitizeFailures.DimensionsTooLarge,
            ImageSanitizer.Sanitize(TestImages.Png(ImageSanitizer.MaxSourceEdge + 1, 2), "image/png", Max).FailureCode);
    }

    [Fact]
    public void TheOutputGuardDetectsMetadataChunks()
    {
        var withExif = TestImages.WebpWithExifChunk();

        Assert.True(ImageSanitizer.HasMetadataChunk(withExif));
        Assert.True(ImageSanitizer.HasMetadataChunk(TestImages.Png()));
        Assert.True(ImageSanitizer.HasMetadataChunk(withExif[..^3]));
        Assert.False(ImageSanitizer.HasMetadataChunk(ImageSanitizer.Sanitize(TestImages.Png(), "image/png", Max).Image!.Full));
    }
}
