using Microsoft.EntityFrameworkCore;
using Patika.Contracts.Media;
using Patika.Infrastructure.Persistence;

namespace Patika.Worker.Jobs.Media;

public sealed record UploadRecord(Guid UserId, string ContentType, long ContentLength, string State);

/// <summary>Worker side of the <c>uploads</c> ledger the API writes at presign time.</summary>
public interface IUploadStateStore
{
    Task<UploadRecord?> FindAsync(string photoKey, CancellationToken cancellationToken);

    Task MarkAsync(string photoKey, string state, string? failureCode, DateTimeOffset now, CancellationToken cancellationToken);
}

public static class UploadStates
{
    public const string Pending = "Pending";
    public const string Ready = "Ready";
    public const string Quarantined = "Quarantined";
}

public sealed class PgUploadStateStore(PatikaDbContext db) : IUploadStateStore
{
    public async Task<UploadRecord?> FindAsync(string photoKey, CancellationToken cancellationToken)
    {
        var rows = await db.Database.SqlQuery<UploadRecord>($"""
            SELECT user_id AS "UserId", content_type AS "ContentType", content_length AS "ContentLength", state AS "State"
            FROM uploads WHERE key = {photoKey}
            """).ToListAsync(cancellationToken);
        return rows.SingleOrDefault();
    }

    public async Task MarkAsync(string photoKey, string state, string? failureCode, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var utc = now.ToUniversalTime();
        await db.Database.ExecuteSqlAsync($"""
            UPDATE uploads SET state = {state}, failure_code = {failureCode}, processed_at = {utc}, updated_at = {utc}
            WHERE key = {photoKey}
            """, cancellationToken);
    }
}

public enum MediaOutcome
{
    Ready,
    Quarantined,
    Skipped,
}

/// <summary>
/// Moves one object out of <c>incoming/</c>: sanitized renditions to <c>media/</c> on success, the
/// untouched bytes to <c>quarantine/</c> on any failure. Transient storage errors leave the object
/// in place for the next run.
/// </summary>
public sealed class MediaProcessor(IObjectStore storage, IUploadStateStore uploads, TimeProvider clock, ILogger<MediaProcessor> logger)
{
    public const string WebpContentType = "image/webp";

    public async Task<MediaOutcome> ProcessAsync(string objectKey, CancellationToken cancellationToken)
    {
        if (!MediaKeys.TryFromIncoming(objectKey, out var photoKey))
        {
            // Not a key the API ever issues: keep it out of the pipeline, without inventing a photo key.
            await MoveAsync(objectKey, MediaKeys.QuarantinePrefix + "unrecognized/" + Guid.CreateVersion7().ToString("N"), cancellationToken);
            logger.LogWarning("Quarantined an incoming object with an unrecognized key");
            return MediaOutcome.Quarantined;
        }

        var upload = await uploads.FindAsync(photoKey, cancellationToken);
        if (upload is null)
        {
            return await QuarantineAsync(photoKey, "unknown_upload", recorded: false, cancellationToken);
        }

        var length = await storage.GetLengthAsync(objectKey, cancellationToken);
        if (length is null)
        {
            return MediaOutcome.Skipped;
        }

        // Size is checked before the body is read, so an oversized object is never buffered.
        if (length.Value > MediaKeys.MaxUploadBytes || length.Value != upload.ContentLength)
        {
            var code = length.Value > MediaKeys.MaxUploadBytes ? SanitizeFailures.TooLarge : SanitizeFailures.LengthMismatch;
            return await QuarantineAsync(photoKey, code, recorded: true, cancellationToken);
        }

        var stored = await storage.GetAsync(objectKey, cancellationToken);
        if (stored is null)
        {
            return MediaOutcome.Skipped;
        }

        if (!string.Equals(stored.ContentType, upload.ContentType, StringComparison.Ordinal))
        {
            return await QuarantineAsync(photoKey, SanitizeFailures.TypeMismatch, recorded: true, cancellationToken);
        }

        var result = ImageSanitizer.Sanitize(stored.Content, upload.ContentType, MediaKeys.MaxUploadBytes);
        if (!result.Succeeded)
        {
            return await QuarantineAsync(photoKey, result.FailureCode!, recorded: true, cancellationToken);
        }

        var image = result.Image!;
        await storage.PutAsync(MediaKeys.Rendition(photoKey, null), image.Full, WebpContentType, cancellationToken);
        await storage.PutAsync(MediaKeys.Rendition(photoKey, ImageSanitizer.MediumEdge), image.Medium, WebpContentType, cancellationToken);
        await storage.PutAsync(MediaKeys.Rendition(photoKey, ImageSanitizer.SmallEdge), image.Small, WebpContentType, cancellationToken);
        await storage.DeleteAsync(objectKey, cancellationToken);
        await uploads.MarkAsync(photoKey, UploadStates.Ready, null, clock.GetUtcNow(), cancellationToken);
        return MediaOutcome.Ready;
    }

    private async Task<MediaOutcome> QuarantineAsync(string photoKey, string code, bool recorded, CancellationToken cancellationToken)
    {
        await MoveAsync(MediaKeys.Incoming(photoKey), MediaKeys.Quarantine(photoKey), cancellationToken);
        if (recorded)
        {
            await uploads.MarkAsync(photoKey, UploadStates.Quarantined, code, clock.GetUtcNow(), cancellationToken);
        }

        logger.LogWarning("Quarantined upload {PhotoKey}: {FailureCode}", photoKey, code);
        return MediaOutcome.Quarantined;
    }

    private async Task MoveAsync(string from, string to, CancellationToken cancellationToken)
    {
        await storage.CopyAsync(from, to, cancellationToken);
        await storage.DeleteAsync(from, cancellationToken);
    }
}
