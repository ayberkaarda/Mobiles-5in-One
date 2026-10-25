namespace Patika.Contracts.Media;

/// <summary>Asks for a presigned PUT. <c>Kind</c> is <c>station|animal|feeding|urgent</c>.</summary>
public sealed record PresignUploadRequest(string Kind, string ContentType, long ContentLength);

/// <summary>
/// A short-lived presigned PUT. The client must send exactly the listed headers; the storage
/// rejects any other <c>Content-Type</c> or <c>Content-Length</c>. <c>Key</c> is the value that
/// later requests (station, animal, feeding, urgent) pass as their photo key.
/// </summary>
public sealed record PresignUploadResponse(
    Guid UploadId,
    string Key,
    string Method,
    string UploadUrl,
    IReadOnlyDictionary<string, string> Headers,
    DateTimeOffset ExpiresAt,
    int RemainingToday);

public static class MediaErrorCodes
{
    public const string QuotaExceeded = "upload_quota_exceeded";
    public const string StorageUnavailable = "storage_unavailable";
}
