using System.Buffers.Binary;
using SkiaSharp;

namespace Patika.Worker.Jobs.Media;

public sealed record SanitizedImage(byte[] Full, byte[] Medium, byte[] Small, int Width, int Height);

public sealed record SanitizeResult(SanitizedImage? Image, string? FailureCode)
{
    public bool Succeeded => Image is not null;

    public static SanitizeResult Fail(string code) => new(null, code);
}

public static class SanitizeFailures
{
    public const string Empty = "empty";
    public const string TooLarge = "too_large";
    public const string LengthMismatch = "length_mismatch";
    public const string UnknownSignature = "unknown_signature";
    public const string TypeMismatch = "type_mismatch";
    public const string DimensionsTooLarge = "dimensions_too_large";
    public const string DecodeFailed = "decode_failed";
    public const string MetadataSurvived = "metadata_survived";
}

/// <summary>
/// Re-encodes an upload to WebP (max 1600 px, renditions 800 and 320) with SkiaSharp. The bytes must
/// start with the magic signature of the declared type; anything else is a failure, never a guess.
/// Metadata is removed twice: the image is decoded to bare pixels and re-encoded (Skia's WebP encoder
/// takes no metadata), and every output is then scanned for EXIF/XMP/ICC chunks before it is kept.
/// </summary>
public static class ImageSanitizer
{
    public const int MaxEdge = 1600;
    public const int MediumEdge = 800;
    public const int SmallEdge = 320;
    public const int MaxSourceEdge = 12_000;
    public const long MaxSourcePixels = 40_000_000;
    public const int Quality = 80;

    /// <summary>The content type implied by the leading bytes, or null for anything that is not JPEG, PNG or WebP.</summary>
    public static string? SniffContentType(ReadOnlySpan<byte> data)
    {
        if (data is [0xFF, 0xD8, 0xFF, ..])
        {
            return "image/jpeg";
        }

        if (data is [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ..])
        {
            return "image/png";
        }

        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data[8..12].SequenceEqual("WEBP"u8))
        {
            return "image/webp";
        }

        return null;
    }

    public static SanitizeResult Sanitize(byte[] data, string declaredContentType, long maxBytes)
    {
        if (data.Length == 0)
        {
            return SanitizeResult.Fail(SanitizeFailures.Empty);
        }

        if (data.Length > maxBytes)
        {
            return SanitizeResult.Fail(SanitizeFailures.TooLarge);
        }

        var sniffed = SniffContentType(data);
        if (sniffed is null)
        {
            return SanitizeResult.Fail(SanitizeFailures.UnknownSignature);
        }

        if (!string.Equals(sniffed, declaredContentType, StringComparison.Ordinal))
        {
            return SanitizeResult.Fail(SanitizeFailures.TypeMismatch);
        }

        using var codec = SKCodec.Create(new SKMemoryStream(data));
        if (codec is null)
        {
            return SanitizeResult.Fail(SanitizeFailures.DecodeFailed);
        }

        if (!string.Equals(MimeOf(codec.EncodedFormat), sniffed, StringComparison.Ordinal))
        {
            return SanitizeResult.Fail(SanitizeFailures.TypeMismatch);
        }

        var info = codec.Info;
        if (info.Width <= 0 || info.Height <= 0 || info.Width > MaxSourceEdge || info.Height > MaxSourceEdge
            || (long)info.Width * info.Height > MaxSourcePixels)
        {
            return SanitizeResult.Fail(SanitizeFailures.DimensionsTooLarge);
        }

        using var decoded = new SKBitmap(new SKImageInfo(info.Width, info.Height, SKColorType.Rgba8888, SKAlphaType.Premul));
        if (codec.GetPixels(decoded.Info, decoded.GetPixels()) != SKCodecResult.Success)
        {
            return SanitizeResult.Fail(SanitizeFailures.DecodeFailed);
        }

        // Orientation is applied from EXIF first; from here on the pixels stand on their own.
        using var upright = Orient(decoded, codec.EncodedOrigin);
        var (width, height) = Fit(upright.Width, upright.Height, MaxEdge);
        var full = Encode(upright, (width, height));
        var medium = Encode(upright, Fit(upright.Width, upright.Height, MediumEdge));
        var small = Encode(upright, Fit(upright.Width, upright.Height, SmallEdge));
        if (full is null || medium is null || small is null)
        {
            return SanitizeResult.Fail(SanitizeFailures.DecodeFailed);
        }

        if (HasMetadataChunk(full) || HasMetadataChunk(medium) || HasMetadataChunk(small))
        {
            return SanitizeResult.Fail(SanitizeFailures.MetadataSurvived);
        }

        return new SanitizeResult(new SanitizedImage(full, medium, small, width, height), null);
    }

    /// <summary>
    /// True when a WebP file carries an <c>EXIF</c>, <c>XMP </c> or <c>ICCP</c> chunk, or is not a
    /// well-formed RIFF/WEBP container (treated the same way).
    /// </summary>
    public static bool HasMetadataChunk(ReadOnlySpan<byte> webp)
    {
        if (webp.Length < 12 || !webp[..4].SequenceEqual("RIFF"u8) || !webp[8..12].SequenceEqual("WEBP"u8))
        {
            return true;
        }

        var offset = 12L;
        while (offset + 8 <= webp.Length)
        {
            var fourCc = webp.Slice((int)offset, 4);
            if (fourCc.SequenceEqual("EXIF"u8) || fourCc.SequenceEqual("XMP "u8) || fourCc.SequenceEqual("ICCP"u8))
            {
                return true;
            }

            var size = BinaryPrimitives.ReadUInt32LittleEndian(webp.Slice((int)offset + 4, 4));
            offset += 8L + size + (size & 1);
        }

        return offset != webp.Length;
    }

    private static string? MimeOf(SKEncodedImageFormat format) => format switch
    {
        SKEncodedImageFormat.Jpeg => "image/jpeg",
        SKEncodedImageFormat.Png => "image/png",
        SKEncodedImageFormat.Webp => "image/webp",
        _ => null,
    };

    private static (int Width, int Height) Fit(int width, int height, int edge)
    {
        if (width <= edge && height <= edge)
        {
            return (width, height);
        }

        var scale = (double)edge / Math.Max(width, height);
        return (Math.Max(1, (int)Math.Round(width * scale)), Math.Max(1, (int)Math.Round(height * scale)));
    }

    private static byte[]? Encode(SKBitmap source, (int Width, int Height) size)
    {
        using var surface = SKSurface.Create(new SKImageInfo(size.Width, size.Height, SKColorType.Rgba8888, SKAlphaType.Premul));
        if (surface is null)
        {
            return null;
        }

        using var image = SKImage.FromBitmap(source);
        surface.Canvas.Clear(SKColors.Transparent);
        surface.Canvas.DrawImage(image, new SKRect(0, 0, size.Width, size.Height),
            new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        using var snapshot = surface.Snapshot();
        using var encoded = snapshot.Encode(SKEncodedImageFormat.Webp, Quality);
        return encoded?.ToArray();
    }

    /// <summary>Applies the EXIF orientation to the pixels (all eight cases).</summary>
    private static SKBitmap Orient(SKBitmap source, SKEncodedOrigin origin)
    {
        var swap = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
            or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var result = new SKBitmap(new SKImageInfo(
            swap ? source.Height : source.Width, swap ? source.Width : source.Height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using var canvas = new SKCanvas(result);
        canvas.Clear(SKColors.Transparent);
        float w = source.Width;
        float h = source.Height;
        // x' = scaleX*x + skewX*y + transX; y' = skewY*x + scaleY*y + transY.
        var matrix = origin switch
        {
            SKEncodedOrigin.TopRight => new SKMatrix(-1, 0, w, 0, 1, 0, 0, 0, 1),
            SKEncodedOrigin.BottomRight => new SKMatrix(-1, 0, w, 0, -1, h, 0, 0, 1),
            SKEncodedOrigin.BottomLeft => new SKMatrix(1, 0, 0, 0, -1, h, 0, 0, 1),
            SKEncodedOrigin.LeftTop => new SKMatrix(0, 1, 0, 1, 0, 0, 0, 0, 1),
            SKEncodedOrigin.RightTop => new SKMatrix(0, -1, h, 1, 0, 0, 0, 0, 1),
            SKEncodedOrigin.RightBottom => new SKMatrix(0, -1, h, -1, 0, w, 0, 0, 1),
            SKEncodedOrigin.LeftBottom => new SKMatrix(0, 1, 0, -1, 0, w, 0, 0, 1),
            _ => SKMatrix.Identity,
        };
        canvas.SetMatrix(matrix);
        using var pixels = SKImage.FromBitmap(source);
        canvas.DrawImage(pixels, 0, 0, new SKSamplingOptions(SKFilterMode.Nearest));
        canvas.Flush();
        return result;
    }
}
