namespace Patika.App.Core.Media;

/// <summary>What a JPEG holds, as far as the sanitizer cares.</summary>
public sealed record JpegInfo(int Width, int Height, IReadOnlyList<byte> Markers, bool HasTrailingBytes)
{
    /// <summary>
    /// True when anything besides image data is left: an APPn segment (EXIF, GPS, XMP, ICC, JFIF, maker
    /// notes), a comment, an unknown marker, or bytes after the end-of-image marker (for example a second
    /// picture appended by the camera).
    /// </summary>
    public bool HasMetadata => HasTrailingBytes || Markers.Any(m => !JpegSanitizer.IsImageMarker(m));
}

/// <summary>
/// Rewrites a JPEG keeping only what is needed to decode the pixels: quantization and Huffman tables,
/// frame and scan headers, restart intervals and the entropy-coded data. Everything else is dropped by
/// whitelist, so EXIF (with GPS position, time and device), XMP, ICC, JFIF, comments, embedded thumbnails
/// and anything appended after the end of the image never leave the phone. The pixels are not
/// re-encoded here; orientation must already be applied to them (see <see cref="IImageTranscoder"/>).
/// </summary>
public static class JpegSanitizer
{
    private const byte Soi = 0xD8;
    private const byte Eoi = 0xD9;
    private const byte Sos = 0xDA;

    /// <summary>Marker value used in the layout for a run of entropy-coded data after a scan header.</summary>
    private const byte ScanData = 0x00;

    /// <summary>Segments that carry image data. Everything else is metadata or unknown and is dropped.</summary>
    public static bool IsImageMarker(byte marker) => marker switch
    {
        0xC4 => true, // DHT
        0xCC => true, // DAC
        0xDB => true, // DQT
        0xDD => true, // DRI
        0xDA => true, // SOS
        0xDC => true, // DNL
        >= 0xD0 and <= 0xD7 => true, // RSTn
        0xC8 => false, // JPG (reserved)
        >= 0xC0 and <= 0xCF => true, // SOFn
        _ => false,
    };

    /// <summary>Returns a copy of <paramref name="jpeg"/> without any metadata.</summary>
    /// <exception cref="PhotoException">The bytes are not a complete JPEG.</exception>
    public static byte[] Strip(byte[] jpeg)
    {
        var layout = Parse(jpeg);
        using var output = new MemoryStream(jpeg.Length);
        output.WriteByte(0xFF);
        output.WriteByte(Soi);
        foreach (var segment in layout.Segments)
        {
            if (segment.Marker == ScanData || IsImageMarker(segment.Marker))
            {
                output.Write(jpeg, segment.Start, segment.Length);
            }
        }

        output.WriteByte(0xFF);
        output.WriteByte(Eoi);
        return output.ToArray();
    }

    /// <summary>Reads the frame size and the list of markers without changing anything.</summary>
    /// <exception cref="PhotoException">The bytes are not a complete JPEG or have no frame header.</exception>
    public static JpegInfo Inspect(byte[] jpeg)
    {
        var layout = Parse(jpeg);
        if (layout.Width <= 0 || layout.Height <= 0)
        {
            throw PhotoException.Unreadable();
        }

        var markers = layout.Segments.Where(s => s.Marker != ScanData).Select(s => s.Marker).ToArray();
        return new JpegInfo(layout.Width, layout.Height, markers, layout.End < jpeg.Length);
    }

    private readonly record struct Segment(byte Marker, int Start, int Length);

    private sealed record Layout(List<Segment> Segments, int Width, int Height, int End);

    private static Layout Parse(byte[] data)
    {
        if (data.Length < 4 || data[0] != 0xFF || data[1] != Soi)
        {
            throw PhotoException.Unreadable();
        }

        var segments = new List<Segment>();
        int width = 0, height = 0;
        var i = 2;
        while (i < data.Length)
        {
            if (data[i] != 0xFF)
            {
                throw PhotoException.Unreadable();
            }

            while (i < data.Length && data[i] == 0xFF)
            {
                i++; // fill bytes before a marker
            }

            if (i >= data.Length)
            {
                break;
            }

            var marker = data[i++];
            if (marker == Eoi)
            {
                return new Layout(segments, width, height, i);
            }

            if (marker == Soi || marker == 0x01 || marker is >= 0xD0 and <= 0xD7)
            {
                // Stand-alone markers have no length. A second SOI is not valid here.
                if (marker == Soi)
                {
                    throw PhotoException.Unreadable();
                }

                segments.Add(new Segment(marker, i - 2, 2));
                continue;
            }

            if (i + 2 > data.Length)
            {
                throw PhotoException.Unreadable();
            }

            var length = (data[i] << 8) | data[i + 1];
            if (length < 2 || i + length > data.Length)
            {
                throw PhotoException.Unreadable();
            }

            // Written from the marker byte pair, without the fill bytes that preceded it.
            segments.Add(new Segment(marker, i - 2, length + 2));
            if (marker is >= 0xC0 and <= 0xCF && marker is not 0xC4 and not 0xC8 and not 0xCC && length >= 7)
            {
                height = (data[i + 3] << 8) | data[i + 4];
                width = (data[i + 5] << 8) | data[i + 6];
            }

            i += length;
            if (marker == Sos)
            {
                var scan = i;
                i = SkipEntropyData(data, i);
                segments.Add(new Segment(ScanData, scan, i - scan));
            }
        }

        // No end-of-image marker: a truncated file.
        throw PhotoException.Unreadable();
    }

    /// <summary>
    /// Entropy-coded data runs until a marker that is neither a stuffed zero (FF 00) nor a restart
    /// marker (FF D0..D7), which stay part of the data.
    /// </summary>
    private static int SkipEntropyData(byte[] data, int i)
    {
        while (i < data.Length)
        {
            if (data[i] == 0xFF && i + 1 < data.Length)
            {
                var next = data[i + 1];
                if (next == 0x00 || next is >= 0xD0 and <= 0xD7)
                {
                    i += 2;
                    continue;
                }

                return i;
            }

            i++;
        }

        throw PhotoException.Unreadable();
    }
}
