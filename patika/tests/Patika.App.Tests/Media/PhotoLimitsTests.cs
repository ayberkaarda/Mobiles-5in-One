using Patika.App.Core.Media;
using Xunit;

namespace Patika.App.Tests.Media;

public sealed class PhotoLimitsTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData(4032, 3024, 2)] // 12 MP phone photo: 2016 x 1512, still above 1600
    [InlineData(1600, 1200, 1)]
    [InlineData(8000, 6000, 4)]
    [InlineData(800, 600, 1)]
    public void Subsampling_keeps_the_longer_edge_at_or_above_the_target(int w, int h, int expected)
    {
        Assert.Equal(expected, PhotoSizing.SampleSize(w, h, PhotoPipeline.MaxEdge));
    }

    [Theory]
    [InlineData(1500, 60000)] // a 90 MP strip whose long edge would otherwise allow little subsampling
    [InlineData(1599, 1599000)]
    [InlineData(30000, 30000)]
    public void Subsampling_always_brings_the_decoded_image_within_the_pixel_budget(int w, int h)
    {
        var sample = PhotoSizing.SampleSize(w, h, PhotoPipeline.MaxEdge);
        var pixels = (long)Math.Ceiling((double)w / sample) * (long)Math.Ceiling((double)h / sample);

        Assert.True(pixels <= PhotoSizing.MaxDecodedPixels, $"{sample}: {pixels}");
        Assert.True(sample == 1 || pixels * 4 > PhotoSizing.MaxDecodedPixels || Math.Max(w, h) / sample >= PhotoPipeline.MaxEdge);
    }

    [Fact]
    public async Task Reading_stops_at_the_byte_limit_without_buffering_the_rest()
    {
        var endless = new CountingStream(100L * 1024 * 1024);

        var e = await Assert.ThrowsAsync<PhotoException>(() => PhotoSizing.ReadBoundedAsync(endless, PhotoSizing.MaxSourceBytes, Ct));

        Assert.Equal(PhotoException.FileTooLargeText, e.Message);
        Assert.True(endless.Served <= PhotoSizing.MaxSourceBytes + 81920);
        var small = await PhotoSizing.ReadBoundedAsync(new MemoryStream(new byte[1000]), PhotoSizing.MaxSourceBytes, Ct);
        Assert.Equal(1000, small.Length);
    }

    /// <summary>A non-seekable stream of zeros that counts what it handed out.</summary>
    private sealed class CountingStream(long length) : Stream
    {
        public long Served { get; private set; }

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position { get => Served; set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count)
        {
            var n = (int)Math.Min(count, length - Served);
            Array.Clear(buffer, offset, n);
            Served += n;
            return n;
        }

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
