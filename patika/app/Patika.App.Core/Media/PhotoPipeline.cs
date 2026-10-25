using Patika.Contracts.Media;

namespace Patika.App.Core.Media;

/// <summary>Fits an image into a square of <c>maxEdge</c> without enlarging it, and keeps decoding within budget.</summary>
public static class PhotoSizing
{
    /// <summary>A picked file larger than this is refused before it is read further.</summary>
    public const long MaxSourceBytes = 30L * 1024 * 1024;

    /// <summary>At most this many pixels are ever decoded into memory, whatever the file claims.</summary>
    public const long MaxDecodedPixels = 40_000_000;

    /// <summary>
    /// The power-of-two subsampling for the decoder: as large as possible while the longer edge stays at or
    /// above <paramref name="maxEdge"/>, and at least large enough that the decoded image fits
    /// <see cref="MaxDecodedPixels"/>.
    /// </summary>
    public static int SampleSize(int width, int height, int maxEdge, long maxPixels = MaxDecodedPixels)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(width);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(height);
        var longer = Math.Max(width, height);
        var sample = 1;
        while (longer / (sample * 2) >= maxEdge)
        {
            sample *= 2;
        }

        while ((long)Math.Ceiling((double)width / sample) * (long)Math.Ceiling((double)height / sample) > maxPixels)
        {
            sample *= 2;
        }

        return sample;
    }

    /// <summary>Reads at most <paramref name="maxBytes"/>; a longer stream is refused without buffering the rest.</summary>
    /// <exception cref="PhotoException">The file is larger than <paramref name="maxBytes"/>.</exception>
    public static async Task<byte[]> ReadBoundedAsync(Stream source, long maxBytes, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await source.ReadAsync(chunk, ct).ConfigureAwait(false)) > 0)
        {
            if (buffer.Length + read > maxBytes)
            {
                throw PhotoException.FileTooLarge();
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    public static (int Width, int Height) Fit(int width, int height, int maxEdge)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(width);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(height);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxEdge);
        var longer = Math.Max(width, height);
        if (longer <= maxEdge)
        {
            return (width, height);
        }

        var scale = (double)maxEdge / longer;
        return (Math.Max(1, (int)Math.Round(width * scale)), Math.Max(1, (int)Math.Round(height * scale)));
    }
}

/// <summary>
/// The on-phone half of the photo flow: platform decode and resize (<see cref="IImageTranscoder"/>), then
/// <see cref="JpegSanitizer"/> on the result, then a check that the bytes really are a clean JPEG of the
/// right size. The sanitizer runs on every output, so the guarantee does not depend on what the platform
/// encoder writes.
/// </summary>
public sealed class PhotoPipeline(IImageTranscoder transcoder)
{
    public const int MaxEdge = 1600;

    /// <summary>Tried in order until the JPEG fits the API's upload limit.</summary>
    internal static readonly int[] Qualities = [85, 75, 65, 50];

    public async Task<PreparedPhoto> PrepareAsync(PickedPhoto photo, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(photo);
        foreach (var quality in Qualities)
        {
            byte[] encoded;
            var source = await photo.OpenAsync(ct).ConfigureAwait(false);
            await using (source.ConfigureAwait(false))
            {
                encoded = await transcoder.ToJpegAsync(source, MaxEdge, quality, ct).ConfigureAwait(false);
            }

            var clean = Sanitize(encoded);
            if (clean.Length <= MediaKeys.MaxUploadBytes)
            {
                var info = JpegSanitizer.Inspect(clean);
                return new PreparedPhoto(clean, info.Width, info.Height);
            }
        }

        throw PhotoException.TooLarge();
    }

    /// <summary>Strips and verifies; throws rather than return anything with metadata or over the size.</summary>
    internal static byte[] Sanitize(byte[] encoded)
    {
        var clean = JpegSanitizer.Strip(encoded);
        var info = JpegSanitizer.Inspect(clean);
        if (info.HasMetadata || info.Width > MaxEdge || info.Height > MaxEdge)
        {
            throw PhotoException.Unreadable();
        }

        return clean;
    }
}
