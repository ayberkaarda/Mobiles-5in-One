using System.Buffers.Binary;
using System.Text;
using SkiaSharp;

namespace Patika.Worker.Tests;

public static class TestImages
{
    /// <summary>Distinctive strings written into EXIF so their absence can be checked on raw bytes.</summary>
    public const string DescriptionMarker = "patika-konum-izi-41.00820";
    public const string CameraMarker = "PatikaSahaKamerasi";

    /// <summary>
    /// A JPEG with an APP1 EXIF segment carrying GPS coordinates (Sultanahmet), a camera make, a
    /// description and an optional orientation. The segment is written by hand so the fixture does not
    /// depend on the library under test.
    /// </summary>
    public static byte[] JpegWithGps(int width = 2400, int height = 1800, ushort orientation = 1)
    {
        var jpeg = Encode(width, height, SKEncodedImageFormat.Jpeg, 90);
        var exif = ExifSegment(orientation);
        // Insert right after SOI (FF D8).
        return [.. jpeg[..2], .. exif, .. jpeg[2..]];
    }

    public static byte[] Png(int width = 64, int height = 48) => Encode(width, height, SKEncodedImageFormat.Png, 100);

    public static byte[] Html() => Encoding.UTF8.GetBytes("<!doctype html><script>alert(document.cookie)</script>");

    public static bool Contains(byte[] haystack, string ascii) =>
        haystack.AsSpan().IndexOf(Encoding.ASCII.GetBytes(ascii)) >= 0;

    public static (int Width, int Height, SKEncodedImageFormat Format) Identify(byte[] data)
    {
        using var codec = SKCodec.Create(new SKMemoryStream(data));
        return (codec.Info.Width, codec.Info.Height, codec.EncodedFormat);
    }

    public static (int Width, int Height) Size(byte[] data)
    {
        var (width, height, _) = Identify(data);
        return (width, height);
    }

    /// <summary>A minimal WebP container with an extra EXIF chunk appended.</summary>
    public static byte[] WebpWithExifChunk()
    {
        var webp = Encode(8, 8, SKEncodedImageFormat.Webp, 80);
        var payload = Encoding.ASCII.GetBytes("Exif\0\0" + DescriptionMarker);
        var chunk = new byte[8 + payload.Length + (payload.Length & 1)];
        "EXIF"u8.CopyTo(chunk);
        BinaryPrimitives.WriteUInt32LittleEndian(chunk.AsSpan(4), (uint)payload.Length);
        payload.CopyTo(chunk, 8);
        byte[] result = [.. webp, .. chunk];
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(4), (uint)(result.Length - 8));
        return result;
    }

    private static byte[] Encode(int width, int height, SKEncodedImageFormat format, int quality)
    {
        using var bitmap = new SKBitmap(width, height);
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                bitmap.SetPixel(x, y, new SKColor((byte)(x * 255 / width), (byte)(y * 255 / height), 140));
            }
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(format, quality);
        return data.ToArray();
    }

    /// <summary>APP1 "Exif\0\0" + little-endian TIFF: IFD0 (Orientation, Make, ImageDescription, GPS pointer) and a GPS IFD.</summary>
    private static byte[] ExifSegment(ushort orientation)
    {
        var tiff = new List<byte>();
        void U16(int v) { tiff.Add((byte)v); tiff.Add((byte)(v >> 8)); }
        void U32(long v) { for (var i = 0; i < 4; i++) { tiff.Add((byte)(v >> (8 * i))); } }

        var make = Encoding.ASCII.GetBytes(CameraMarker + "\0");
        var description = Encoding.ASCII.GetBytes(DescriptionMarker + "\0");
        const int ifd0Entries = 4;
        const int gpsEntries = 4;
        var ifd0Size = 2 + ifd0Entries * 12 + 4;
        var makeOffset = 8 + ifd0Size;
        var descriptionOffset = makeOffset + make.Length;
        var gpsOffset = descriptionOffset + description.Length;
        var gpsSize = 2 + gpsEntries * 12 + 4;
        var latOffset = gpsOffset + gpsSize;
        var lngOffset = latOffset + 24;

        tiff.AddRange("II"u8.ToArray());
        U16(42);
        U32(8);
        U16(ifd0Entries);
        U16(0x0112); U16(3); U32(1); U16(orientation); U16(0);
        U16(0x010E); U16(2); U32(description.Length); U32(descriptionOffset);
        U16(0x010F); U16(2); U32(make.Length); U32(makeOffset);
        U16(0x8825); U16(4); U32(1); U32(gpsOffset);
        U32(0);
        tiff.AddRange(make);
        tiff.AddRange(description);
        U16(gpsEntries);
        U16(0x0001); U16(2); U32(2); tiff.AddRange("N\0\0\0"u8.ToArray());
        U16(0x0002); U16(5); U32(3); U32(latOffset);
        U16(0x0003); U16(2); U32(2); tiff.AddRange("E\0\0\0"u8.ToArray());
        U16(0x0004); U16(5); U32(3); U32(lngOffset);
        U32(0);
        foreach (var (n, d) in new[] { (41, 1), (0, 1), (2952, 100), (28, 1), (58, 1), (4224, 100) })
        {
            U32(n);
            U32(d);
        }

        var payload = Encoding.ASCII.GetBytes("Exif\0\0").Concat(tiff).ToArray();
        var length = payload.Length + 2;
        return [0xFF, 0xE1, (byte)(length >> 8), (byte)length, .. payload];
    }
}
