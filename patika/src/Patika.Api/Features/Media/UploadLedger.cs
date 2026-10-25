using Microsoft.EntityFrameworkCore;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Media;

public sealed record UploadReservation(
    Guid Id, Guid UserId, string Kind, string PhotoKey, string ContentType, long ContentLength, DateTimeOffset CreatedAt);

public static class UploadStates
{
    public const string Pending = "Pending";
    public const string Ready = "Ready";
    public const string Quarantined = "Quarantined";
}

/// <summary>Upload records: daily quota and photo-key ownership.</summary>
public interface IUploadLedger
{
    /// <summary>
    /// Atomically records the upload if the user has fewer than <paramref name="limit"/> uploads since
    /// <paramref name="dayStart"/>. Returns the uploads still available today, or null when over quota.
    /// </summary>
    Task<int?> TryReserveAsync(UploadReservation upload, DateTimeOffset dayStart, int limit, CancellationToken cancellationToken);

    /// <summary>True when the photo key was issued to the user and has not been quarantined.</summary>
    Task<bool> IsUsableByAsync(Guid userId, string photoKey, CancellationToken cancellationToken);
}

/// <summary>
/// PostgreSQL ledger over the <c>uploads</c> table (schema proposed in the phase 2 report). The
/// per-user advisory lock serializes concurrent reservations so the quota cannot be overrun.
/// </summary>
public sealed class PgUploadLedger(PatikaDbContext db) : IUploadLedger
{
    public async Task<int?> TryReserveAsync(
        UploadReservation upload, DateTimeOffset dayStart, int limit, CancellationToken cancellationToken)
    {
        var since = dayStart.ToUniversalTime();
        var createdAt = upload.CreatedAt.ToUniversalTime();
        var lockKey = "uploads:" + upload.UserId.ToString("D");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", cancellationToken);
        var used = await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM uploads WHERE user_id = {upload.UserId} AND created_at >= {since}
            """).SingleAsync(cancellationToken);
        if (used >= limit)
        {
            return null;
        }

        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO uploads (id, user_id, kind, key, content_type, content_length, state, created_at, updated_at)
            VALUES ({upload.Id}, {upload.UserId}, {upload.Kind}, {upload.PhotoKey}, {upload.ContentType},
                {upload.ContentLength}, {UploadStates.Pending}, {createdAt}, {createdAt})
            """, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return limit - used - 1;
    }

    public async Task<bool> IsUsableByAsync(Guid userId, string photoKey, CancellationToken cancellationToken) =>
        await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM uploads
            WHERE key = {photoKey} AND user_id = {userId} AND state <> {UploadStates.Quarantined}
            """).SingleAsync(cancellationToken) > 0;
}
