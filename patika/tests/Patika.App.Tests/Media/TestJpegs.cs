using System.Text;
using SkiaSharp;

namespace Patika.App.Tests.Media;

/// <summary>Real JPEGs from SkiaSharp with metadata spliced in the way phone cameras write it.</summary>
internal static class TestJpegs
{
    public const string GpsSentinel = "PATIKA-GPS-40.9861N-29.0270E";
    public const string CommentSentinel = "PATIKA-COMMENT-SENTINEL";
    public const string XmpSentinel = "PATIKA-XMP-SENTINEL";
    public const string TrailerSentinel = "PATIKA-TRAILER-SENTINEL";

    /// <summary>A plain JPEG of the given size, a gradient so the pixels are not trivial.</summary>
    public static byte[] Plain(int width, int height, int quality = 90)
    {
        using var bitmap = new SKBitmap(width, height);
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                bitmap.SetPixel(x, y, new SKColor((byte)(x * 255 / width), (byte)(y * 255 / height), 120));
            }
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Jpeg, quality);
        return data.ToArray();
    }

    /// <summary>
    /// <paramref name="jpeg"/> with, right after SOI: an EXIF APP1 holding a GPS IFD (latitude, longitude
    /// and a processing-method string with <see cref="GpsSentinel"/>), an XMP APP1, an ICC APP2 and a
    /// comment; and after EOI a second "picture" with its own EXIF, as multi-picture cameras append.
    /// </summary>
    public static byte[] WithGpsExif(byte[] jpeg)
    {
        using var output = new MemoryStream();
        output.Write(jpeg, 0, 2); // SOI
        WriteSegment(output, 0xE1, ExifWithGps());
        WriteSegment(output, 0xE1, Encoding.ASCII.GetBytes("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>" + XmpSentinel + "</x:xmpmeta>"));
        WriteSegment(output, 0xE2, [.. Encoding.ASCII.GetBytes("ICC_PROFILE\0"), 1, 1, 0, 0, 0, 0]);
        WriteSegment(output, 0xFE, Encoding.ASCII.GetBytes(CommentSentinel));
        output.Write(jpeg, 2, jpeg.Length - 2);

        // Trailer: FF D8 + EXIF + "image" bytes after the real EOI.
        output.Write([0xFF, 0xD8]);
        WriteSegment(output, 0xE1, ExifWithGps());
        output.Write(Encoding.ASCII.GetBytes(TrailerSentinel));
        output.Write([0xFF, 0xD9]);
        return output.ToArray();
    }

    public static bool Contains(byte[] haystack, string text) => Contains(haystack, Encoding.ASCII.GetBytes(text));

    public static bool Contains(byte[] haystack, byte[] needle) => haystack.AsSpan().IndexOf(needle) >= 0;

    public static (int Width, int Height) Decode(byte[] jpeg)
    {
        using var bitmap = SKBitmap.Decode(jpeg) ?? throw new InvalidOperationException("Not decodable.");
        return (bitmap.Width, bitmap.Height);
    }

    private static void WriteSegment(Stream output, byte marker, byte[] payload)
    {
        var length = payload.Length + 2;
        output.Write([0xFF, marker, (byte)(length >> 8), (byte)(length & 0xFF)]);
        output.Write(payload);
    }

    /// <summary>"Exif\0\0" + little-endian TIFF: IFD0 with a GPSInfo pointer, GPS IFD with lat/lng and a sentinel.</summary>
    private static byte[] ExifWithGps()
    {
        using var tiff = new MemoryStream();
        using var w = new BinaryWriter(tiff);
        w.Write("II"u8);
        w.Write((ushort)42);
        w.Write(8u); // IFD0 offset

        // IFD0 at 8: one entry, GPSInfo (0x8825, LONG) -> GPS IFD at 26.
        w.Write((ushort)1);
        Entry(w, 0x8825, 4, 1, 26);
        w.Write(0u);

        // GPS IFD at 26: 5 entries (2 + 5 * 12 + 4 = 66 bytes), data from 92.
        var method = Encoding.ASCII.GetBytes("ASCII\0\0\0" + GpsSentinel);
        const uint data = 26 + 66;
        w.Write((ushort)5);
        Entry(w, 0x0001, 2, 2, 'N'); // GPSLatitudeRef "N\0"
        Entry(w, 0x0002, 5, 3, data); // GPSLatitude 40 59 10
        Entry(w, 0x0003, 2, 2, 'E'); // GPSLongitudeRef "E\0"
        Entry(w, 0x0004, 5, 3, data + 24); // GPSLongitude 29 1 37
        Entry(w, 0x001B, 7, (uint)method.Length, data + 48); // GPSProcessingMethod
        w.Write(0u);
        foreach (var value in new uint[] { 40, 1, 59, 1, 10, 1, 29, 1, 1, 1, 37, 1 })
        {
            w.Write(value);
        }

        w.Write(method);
        w.Flush();
        return [.. "Exif\0\0"u8.ToArray(), .. tiff.ToArray()];
    }

    private static void Entry(BinaryWriter w, ushort tag, ushort type, uint count, uint value)
    {
        w.Write(tag);
        w.Write(type);
        w.Write(count);
        w.Write(value);
    }
}

/// <summary>Stands in for the Android codec: returns the input unchanged, as an encoder that keeps EXIF would.</summary>
internal sealed class PassThroughTranscoder : Patika.App.Core.Media.IImageTranscoder
{
    public List<int> Qualities { get; } = [];

    public Func<int, byte[]>? Override { get; set; }

    public async Task<byte[]> ToJpegAsync(Stream source, int maxEdge, int quality, CancellationToken ct)
    {
        Qualities.Add(quality);
        if (Override is not null)
        {
            return Override(quality);
        }

        using var copy = new MemoryStream();
        await source.CopyToAsync(copy, ct);
        return copy.ToArray();
    }
}
