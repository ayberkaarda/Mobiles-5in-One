using Patika.App.Core.Api;

namespace Patika.App.Core.Media;

/// <summary>
/// A photo the user picked or took, not yet read. <see cref="OpenAsync"/> may be called more than once
/// (the pipeline retries at a lower quality when the result is too large).
/// </summary>
public sealed record PickedPhoto(string FileName, string? ContentType, Func<CancellationToken, Task<Stream>> OpenAsync);

/// <summary>
/// A JPEG ready to upload: at most <see cref="PhotoPipeline.MaxEdge"/> pixels on the longer side and
/// without any metadata. Only <see cref="PhotoPipeline"/> creates it, so an upload can never send bytes
/// that skipped the sanitizer.
/// </summary>
public sealed class PreparedPhoto
{
    internal PreparedPhoto(byte[] jpeg, int width, int height)
    {
        Jpeg = jpeg;
        Width = width;
        Height = height;
    }

    public const string ContentType = "image/jpeg";

    public byte[] Jpeg { get; }

    public int Width { get; }

    public int Height { get; }

    public long Length => Jpeg.LongLength;

    /// <summary>A fresh stream over the bytes, for a preview image on the form.</summary>
    public Stream OpenRead() => new MemoryStream(Jpeg, writable: false);
}

/// <summary>Decodes a picked photo with the platform codecs and writes a plain JPEG.</summary>
public interface IImageTranscoder
{
    /// <summary>
    /// Decodes <paramref name="source"/> (JPEG, PNG, WebP, HEIC/HEIF), turns the pixels upright according
    /// to its orientation tag, scales it so the longer edge is at most <paramref name="maxEdge"/> and
    /// encodes it as a baseline JPEG at <paramref name="quality"/> (1..100).
    /// </summary>
    /// <exception cref="PhotoException">The image cannot be decoded.</exception>
    Task<byte[]> ToJpegAsync(Stream source, int maxEdge, int quality, CancellationToken ct);
}

/// <summary>Camera and gallery. The app wraps MAUI's <c>MediaPicker</c>.</summary>
public interface IPhotoPicker
{
    bool CanCapture { get; }

    /// <summary>Opens the camera; null when the user cancels.</summary>
    Task<PickedPhoto?> CaptureAsync(CancellationToken ct = default);

    /// <summary>Opens the gallery; null when the user cancels.</summary>
    Task<PickedPhoto?> PickAsync(CancellationToken ct = default);
}

/// <summary>
/// Photo upload for every screen that needs one (station, feeding, animal, urgent). Prepare first so the
/// form can show exactly what will be sent; then upload and pass the returned key as the request's
/// <c>photoKey</c>.
/// </summary>
public interface IPhotoUploader
{
    /// <summary>Re-encodes to JPEG (max 1600 px, upright) and strips all metadata, GPS included, on the phone.</summary>
    /// <exception cref="PhotoException">Not an image, or still over 5 MB at the lowest quality.</exception>
    Task<PreparedPhoto> PrepareAsync(PickedPhoto photo, CancellationToken ct = default);

    /// <summary>
    /// Presigns with <c>POST /v1/uploads/presign</c> (<paramref name="kind"/> is <c>station|animal|feeding|urgent</c>),
    /// PUTs the bytes with exactly the presigned <c>Content-Type</c> and <c>Content-Length</c>, and returns the photo key.
    /// </summary>
    /// <exception cref="ApiException">Presign or upload failed; the message is Turkish text for the user.</exception>
    Task<string> UploadAsync(PreparedPhoto photo, string kind, CancellationToken ct = default);
}

/// <summary>A photo that cannot be used; <see cref="Exception.Message"/> is Turkish text for the user.</summary>
public sealed class PhotoException(string message, Exception? inner = null) : Exception(message, inner)
{
    public const string UnreadableText = "Bu fotoğraf açılamadı. Başka bir fotoğraf seç.";
    public const string TooLargeText = "Fotoğraf çok büyük. Daha yakından ya da daha az ayrıntılı bir kare dene.";

    public static PhotoException Unreadable(Exception? inner = null) => new(UnreadableText, inner);

    public static PhotoException TooLarge() => new(TooLargeText);

    public const string FileTooLargeText = "Bu fotoğraf dosyası çok büyük (30 MB üstü). Daha küçük bir fotoğraf seç.";

    public static PhotoException FileTooLarge() => new(FileTooLargeText);
}

/// <summary>Turkish text and codes for upload failures that are not problem details from the API.</summary>
public static class UploadErrors
{
    public const string PutFailedCode = "upload_put_failed";
    public const string BadPresignCode = "upload_presign_invalid";
    public const string PutFailedText = "Fotoğraf yüklenemedi. Biraz sonra yeniden dene.";
}
