using System.Diagnostics.CodeAnalysis;

namespace Patika.Contracts.Media;

/// <summary>
/// Object-key layout shared by the API (presign) and the worker (post-processing). A photo key is
/// <c>{kind}/{uploadId}</c>; the raw upload lives under <c>incoming/</c>, the sanitized WebP
/// renditions under <c>media/</c> and rejected bytes under <c>quarantine/</c>.
/// </summary>
public static class MediaKeys
{
    public const string IncomingPrefix = "incoming/";
    public const string MediaPrefix = "media/";
    public const string QuarantinePrefix = "quarantine/";
    public const long MaxUploadBytes = 5 * 1024 * 1024;

    public static IReadOnlyList<string> Kinds { get; } = ["station", "animal", "feeding", "urgent"];

    public static IReadOnlyList<string> ContentTypes { get; } = ["image/jpeg", "image/png", "image/webp"];

    public static bool IsKind(string? kind) => kind is not null && Kinds.Contains(kind, StringComparer.Ordinal);

    public static bool IsContentType(string? contentType) =>
        contentType is not null && ContentTypes.Contains(contentType, StringComparer.Ordinal);

    public static string PhotoKey(string kind, Guid uploadId) =>
        IsKind(kind) ? $"{kind}/{uploadId:D}" : throw new ArgumentOutOfRangeException(nameof(kind));

    /// <summary>Parses <c>{kind}/{uploadId}</c> exactly (lower-case kind, canonical lower-case GUID).</summary>
    public static bool TryParse(string? photoKey, [NotNullWhen(true)] out string? kind, out Guid uploadId)
    {
        kind = null;
        uploadId = Guid.Empty;
        if (photoKey is null || photoKey.Length > 64)
        {
            return false;
        }

        var slash = photoKey.IndexOf('/', StringComparison.Ordinal);
        if (slash <= 0)
        {
            return false;
        }

        var candidate = photoKey[..slash];
        var id = photoKey[(slash + 1)..];
        if (!IsKind(candidate) || !Guid.TryParseExact(id, "D", out uploadId) || !string.Equals(id, uploadId.ToString("D"), StringComparison.Ordinal))
        {
            uploadId = Guid.Empty;
            return false;
        }

        kind = candidate;
        return true;
    }

    public static string Incoming(string photoKey) => IncomingPrefix + photoKey;

    public static string Quarantine(string photoKey) => QuarantinePrefix + photoKey;

    /// <summary>The sanitized rendition: <c>null</c> width is the full image (max 1600 px), else 800 or 320.</summary>
    public static string Rendition(string photoKey, int? width) =>
        width is null ? $"{MediaPrefix}{photoKey}.webp" : $"{MediaPrefix}{photoKey}_{width}.webp";

    /// <summary>Recovers the photo key from an <c>incoming/</c> object key; false for anything else.</summary>
    public static bool TryFromIncoming(string objectKey, [NotNullWhen(true)] out string? photoKey)
    {
        photoKey = null;
        if (!objectKey.StartsWith(IncomingPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var candidate = objectKey[IncomingPrefix.Length..];
        if (!TryParse(candidate, out _, out _))
        {
            return false;
        }

        photoKey = candidate;
        return true;
    }
}
