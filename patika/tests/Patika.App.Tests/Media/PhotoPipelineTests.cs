using Patika.App.Core.Media;
using Patika.Contracts.Media;
using Xunit;

namespace Patika.App.Tests.Media;

public sealed class PhotoPipelineTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static PickedPhoto Picked(byte[] bytes) =>
        new("IMG_0001.jpg", "image/jpeg", _ => Task.FromResult<Stream>(new MemoryStream(bytes)));

    [Fact]
    public async Task A_jpeg_with_gps_exif_comes_out_of_the_pipeline_without_any_metadata()
    {
        var original = TestJpegs.WithGpsExif(TestJpegs.Plain(64, 48));
        // The fixture really carries what a camera writes.
        Assert.True(TestJpegs.Contains(original, "Exif\0\0"));
        Assert.True(TestJpegs.Contains(original, TestJpegs.GpsSentinel));
        Assert.True(JpegSanitizer.Inspect(original).HasMetadata);

        var prepared = await new PhotoPipeline(new PassThroughTranscoder()).PrepareAsync(Picked(original), Ct);
        var bytes = prepared.Jpeg;

        // On the bytes: no EXIF header, no TIFF header, no GPS values, no XMP, ICC, comment or trailer.
        Assert.False(TestJpegs.Contains(bytes, "Exif"));
        Assert.False(TestJpegs.Contains(bytes, "II*\0"));
        Assert.False(TestJpegs.Contains(bytes, TestJpegs.GpsSentinel));
        Assert.False(TestJpegs.Contains(bytes, [0x28, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3B, 0x00, 0x00, 0x00])); // 40/1, 59/...
        Assert.False(TestJpegs.Contains(bytes, TestJpegs.XmpSentinel));
        Assert.False(TestJpegs.Contains(bytes, "ICC_PROFILE"));
        Assert.False(TestJpegs.Contains(bytes, TestJpegs.CommentSentinel));
        Assert.False(TestJpegs.Contains(bytes, TestJpegs.TrailerSentinel));
        for (var i = 0; i + 1 < bytes.Length; i++)
        {
            // No APPn (FF E0..EF) or COM (FF FE) marker anywhere; inside entropy data FF is always followed by 00 or RSTn.
            Assert.False(bytes[i] == 0xFF && bytes[i + 1] is (>= 0xE0 and <= 0xEF) or 0xFE, $"metadata marker at {i}");
        }

        Assert.Equal([0xFF, 0xD8], bytes[..2]);
        Assert.Equal([0xFF, 0xD9], bytes[^2..]);
        Assert.False(JpegSanitizer.Inspect(bytes).HasMetadata);

        // Still the same picture.
        Assert.Equal((64, 48), TestJpegs.Decode(bytes));
        Assert.Equal((64, 48), (prepared.Width, prepared.Height));
        Assert.Equal(TestJpegs.Plain(64, 48)[^200..], bytes[^200..]);
    }

    [Fact]
    public void Stripping_keeps_every_image_segment_and_drops_only_metadata()
    {
        var plain = TestJpegs.Plain(40, 30);
        var stripped = JpegSanitizer.Strip(TestJpegs.WithGpsExif(plain));
        var before = JpegSanitizer.Inspect(plain).Markers.Where(JpegSanitizer.IsImageMarker).ToArray();

        Assert.Equal(before, JpegSanitizer.Inspect(stripped).Markers);
        Assert.Equal((40, 30), TestJpegs.Decode(stripped));
    }

    [Theory]
    [InlineData(new byte[] { 0x89, 0x50, 0x4E, 0x47 })]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x40, 0x01 })]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x03, 0x00 })]
    public void Anything_that_is_not_a_complete_jpeg_is_refused(byte[] bytes)
    {
        var e = Assert.Throws<PhotoException>(() => JpegSanitizer.Strip(bytes));
        Assert.Equal(PhotoException.UnreadableText, e.Message);
    }

    [Fact]
    public void A_truncated_jpeg_without_its_end_marker_is_refused()
    {
        var plain = TestJpegs.Plain(40, 30);
        Assert.Throws<PhotoException>(() => JpegSanitizer.Strip(plain[..^2]));
    }

    [Fact]
    public async Task A_transcoder_that_does_not_resize_is_caught()
    {
        var transcoder = new PassThroughTranscoder();
        var huge = TestJpegs.Plain(1700, 20);

        await Assert.ThrowsAsync<PhotoException>(() => new PhotoPipeline(transcoder).PrepareAsync(Picked(huge), Ct));
    }

    [Fact]
    public async Task Quality_steps_down_until_the_file_fits_and_gives_up_after_the_last_step()
    {
        var small = TestJpegs.Plain(32, 32);
        // An oversized but complete JPEG: the scan padded with stuffed zeros.
        var padded = Pad(small, (int)MediaKeys.MaxUploadBytes + 4096);
        var transcoder = new PassThroughTranscoder { Override = q => q > 65 ? padded : small };

        var prepared = await new PhotoPipeline(transcoder).PrepareAsync(Picked(small), Ct);
        Assert.Equal([85, 75, 65], transcoder.Qualities);
        Assert.Equal(32, prepared.Width);

        var always = new PassThroughTranscoder { Override = _ => padded };
        var e = await Assert.ThrowsAsync<PhotoException>(() => new PhotoPipeline(always).PrepareAsync(Picked(small), Ct));
        Assert.Equal(PhotoException.TooLargeText, e.Message);
        Assert.Equal(PhotoPipeline.Qualities, always.Qualities);
    }

    [Theory]
    [InlineData(4032, 3024, 1600, 1200)]
    [InlineData(3024, 4032, 1200, 1600)]
    [InlineData(1600, 900, 1600, 900)]
    [InlineData(800, 600, 800, 600)]
    [InlineData(10000, 3, 1600, 1)]
    public void Sizing_fits_the_longer_edge_into_1600_without_enlarging(int w, int h, int ew, int eh) =>
        Assert.Equal((ew, eh), PhotoSizing.Fit(w, h, PhotoPipeline.MaxEdge));

    /// <summary>Inserts stuffed FF 00 pairs into the scan so the file grows but stays a complete JPEG.</summary>
    private static byte[] Pad(byte[] jpeg, int size)
    {
        var body = jpeg[..^2];
        var padding = new byte[size - jpeg.Length + 1];
        for (var i = 0; i + 1 < padding.Length; i += 2)
        {
            padding[i] = 0xFF;
        }

        return [.. body, .. padding, 0xFF, 0xD9];
    }
}
