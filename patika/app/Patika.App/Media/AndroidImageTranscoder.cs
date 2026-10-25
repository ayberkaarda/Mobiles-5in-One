using Android.Graphics;
using Patika.App.Core.Media;
using AndroidExif = Android.Media.ExifInterface;

namespace Patika.App.Media;

/// <summary>
/// <see cref="IImageTranscoder"/> with the Android codecs. Android 9+ decodes through <c>ImageDecoder</c>
/// (JPEG, PNG, WebP, HEIC/HEIF; it applies the orientation tag itself). Older versions use
/// <c>BitmapFactory</c> and turn the pixels by the EXIF orientation by hand; HEIC needs Android 9.
/// The result is re-encoded from pixels, so no tag of the original is copied; the Core pipeline strips the
/// output once more regardless.
/// </summary>
public sealed class AndroidImageTranscoder : IImageTranscoder
{
    public Task<byte[]> ToJpegAsync(Stream source, int maxEdge, int quality, CancellationToken ct) => Task.Run(async () =>
    {
        // Bounded: a huge file is refused before it fills memory; the pixel budget applies at decode.
        if (source.CanSeek && source.Length > PhotoSizing.MaxSourceBytes)
        {
            throw PhotoException.FileTooLarge();
        }

        var bytes = await PhotoSizing.ReadBoundedAsync(source, PhotoSizing.MaxSourceBytes, ct).ConfigureAwait(false);

        ct.ThrowIfCancellationRequested();
        Bitmap? decoded;
        try
        {
            decoded = OperatingSystem.IsAndroidVersionAtLeast(28) ? DecodeModern(bytes, maxEdge) : DecodeLegacy(bytes, maxEdge);
        }
        catch (Java.Lang.Throwable e)
        {
            throw PhotoException.Unreadable(e);
        }

        if (decoded is null)
        {
            throw PhotoException.Unreadable();
        }

        using (decoded)
        {
            var (width, height) = PhotoSizing.Fit(decoded.Width, decoded.Height, maxEdge);
            var fitted = width == decoded.Width && height == decoded.Height
                ? decoded
                : Bitmap.CreateScaledBitmap(decoded, width, height, filter: true);
            try
            {
                using var output = new MemoryStream();
                if (!fitted.Compress(Bitmap.CompressFormat.Jpeg!, Math.Clamp(quality, 1, 100), output))
                {
                    throw PhotoException.Unreadable();
                }

                return output.ToArray();
            }
            finally
            {
                if (!ReferenceEquals(fitted, decoded))
                {
                    fitted.Recycle();
                    fitted.Dispose();
                }
            }
        }
    }, ct);

    [System.Runtime.Versioning.SupportedOSPlatform("android28.0")]
    private static Bitmap? DecodeModern(byte[] bytes, int maxEdge)
    {
        var source = ImageDecoder.CreateSource(Java.Nio.ByteBuffer.Wrap(bytes));
        using var listener = new HeaderListener(maxEdge);
        return ImageDecoder.DecodeBitmap(source, listener);
    }

    private static Bitmap? DecodeLegacy(byte[] bytes, int maxEdge)
    {
        using var bounds = new BitmapFactory.Options { InJustDecodeBounds = true };
        BitmapFactory.DecodeByteArray(bytes, 0, bytes.Length, bounds);
        if (bounds.OutWidth <= 0 || bounds.OutHeight <= 0)
        {
            return null;
        }

        using var options = new BitmapFactory.Options { InSampleSize = PhotoSizing.SampleSize(bounds.OutWidth, bounds.OutHeight, maxEdge) };
        var bitmap = BitmapFactory.DecodeByteArray(bytes, 0, bytes.Length, options);
        if (bitmap is null)
        {
            return null;
        }

        using var matrix = Orientation(bytes);
        if (matrix is null)
        {
            return bitmap;
        }

        var upright = Bitmap.CreateBitmap(bitmap, 0, 0, bitmap.Width, bitmap.Height, matrix, filter: true);
        if (!ReferenceEquals(upright, bitmap))
        {
            bitmap.Recycle();
            bitmap.Dispose();
        }

        return upright;
    }

    /// <summary>The transform for the EXIF orientation tag, or null when the pixels are already upright.</summary>
    private static Matrix? Orientation(byte[] bytes)
    {
        int orientation;
        try
        {
            using var stream = new MemoryStream(bytes, writable: false);
            using var exif = new AndroidExif(stream);
            orientation = exif.GetAttributeInt(AndroidExif.TagOrientation, 1);
        }
        catch (Java.Lang.Throwable)
        {
            return null;
        }

        var matrix = new Matrix();
        switch (orientation)
        {
            case 2: matrix.SetScale(-1, 1); break;
            case 3: matrix.SetRotate(180); break;
            case 4: matrix.SetScale(1, -1); break;
            case 5: matrix.SetRotate(90); matrix.PostScale(-1, 1); break;
            case 6: matrix.SetRotate(90); break;
            case 7: matrix.SetRotate(-90); matrix.PostScale(-1, 1); break;
            case 8: matrix.SetRotate(-90); break;
            default:
                matrix.Dispose();
                return null;
        }

        return matrix;
    }

    /// <summary>
    /// Runs on the header, before any pixel is decoded: subsamples so the result stays within the pixel budget
    /// and asks for plain software pixels that can be re-encoded.
    /// </summary>
    [System.Runtime.Versioning.SupportedOSPlatform("android28.0")]
    private sealed class HeaderListener(int maxEdge) : Java.Lang.Object, ImageDecoder.IOnHeaderDecodedListener
    {
        public void OnHeaderDecoded(ImageDecoder decoder, ImageDecoder.ImageInfo info, ImageDecoder.Source source)
        {
            decoder.Allocator = ImageDecoderAllocator.Software;
            var size = info.Size;
            decoder.SetTargetSampleSize(PhotoSizing.SampleSize(size.Width, size.Height, maxEdge));
        }
    }
}
