using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Patika.Contracts.Media;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Worker.Jobs.Accounts;

/// <summary>
/// Receives photo keys (<c>{kind}/{uploadId}</c>) whose objects must be removed because their owner was
/// deleted. Implementations remove every physical object of each key (see <see cref="PhotoObjects"/>).
/// The purge calls this before it commits; a failure aborts the purge, which is retried on the next run.
/// </summary>
public interface IObjectKeyRemovalQueue
{
    Task EnqueueAsync(IReadOnlyCollection<string> keys, CancellationToken cancellationToken);
}

public static class PhotoObjects
{
    /// <summary>
    /// Every object a photo key can have in storage: the pending original under <c>incoming/</c>, the
    /// quarantined copy, and the full-size and resized WebP renditions under <c>media/</c>.
    /// </summary>
    public static IReadOnlyList<string> For(string photoKey, IReadOnlyList<int> renditionWidths)
    {
        var keys = new List<string>(3 + renditionWidths.Count)
        {
            MediaKeys.Incoming(photoKey),
            MediaKeys.Quarantine(photoKey),
            MediaKeys.Rendition(photoKey, null),
        };
        keys.AddRange(renditionWidths.Select(width => MediaKeys.Rendition(photoKey, width)));
        return keys;
    }
}

public static class AccountPurgeAuditActions
{
    public const string HardDeleted = "account.hard_deleted";
    public const string UnverifiedRemoved = "account.unverified_removed";
}

/// <summary>
/// The <c>deletion.hard_delete</c> work: for each deletion request whose grace period has ended,
/// removes the user's personal rows, anonymises feedings and sightings (<c>user_id = NULL</c>, note and
/// photo cleared) so station history stays, queues the user's photo keys for removal and replaces the
/// <c>users</c> row with a tombstone that carries no personal data (stations and animals the user added
/// keep pointing at it).
/// </summary>
public sealed class AccountPurger(
    PatikaDbContext db, IObjectKeyRemovalQueue objects, TimeProvider clock, ILogger<AccountPurger> logger)
{
    public const string DeletedDisplayName = "Silinmiş hesap";
    public const int BatchSize = 50;
    public const int DefaultUrgentRadiusM = 2000;

    public async Task<int> PurgeDueAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var due = await db.DeletionRequests.AsNoTracking()
            .Where(r => r.CompletedAt == null && r.CancelledAt == null && r.ExecuteAfter <= now)
            .OrderBy(r => r.ExecuteAfter)
            .Select(r => r.Id)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        var purged = 0;
        foreach (var requestId in due)
        {
            if (await PurgeAsync(requestId, now, cancellationToken))
            {
                purged++;
            }
        }

        if (due.Count > 0)
        {
            logger.LogInformation("Hard delete purged {Purged} of {Due} due accounts", purged, due.Count);
        }

        return purged;
    }

    private async Task<bool> PurgeAsync(Guid requestId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // Lock the request and re-check it: another worker or a cancelling sign-in may have got there first.
        var claimed = await db.DeletionRequests
            .FromSql($"""
                SELECT * FROM deletion_requests
                WHERE id = {requestId} AND completed_at IS NULL AND cancelled_at IS NULL AND execute_after <= {now}
                FOR UPDATE
                """)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
        if (claimed.Count != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        var userId = claimed[0].UserId;
        var stillDeactivated = await db.Users.AnyAsync(u => u.Id == userId && u.DeactivatedAt != null, cancellationToken);
        if (!stillDeactivated)
        {
            // Reactivated by other means: the request is void.
            await db.DeletionRequests.Where(r => r.Id == requestId)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.CancelledAt, now).SetProperty(r => r.UpdatedAt, now),
                    cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return false;
        }

        // Every photo the user uploaded (the uploads ledger covers unattached and failed uploads too) plus
        // every photo key their rows reference. Read before anything is deleted.
        var uploadKeys = await db.Uploads.Where(u => u.UserId == userId).Select(u => u.Key).ToListAsync(cancellationToken);
        var keys = new HashSet<string>(uploadKeys, StringComparer.Ordinal);
        keys.UnionWith(await db.Feedings.Where(f => f.UserId == userId && f.PhotoKey != null)
            .Select(f => f.PhotoKey!).ToListAsync(cancellationToken));
        keys.UnionWith(await db.AnimalPhotos.Where(p => p.CreatedBy == userId)
            .Select(p => p.Key).ToListAsync(cancellationToken));
        keys.UnionWith(await db.UrgentPosts.IgnoreQueryFilters().Where(p => p.CreatedBy == userId)
            .Select(p => p.PhotoKey).ToListAsync(cancellationToken));
        keys.UnionWith(await db.Stations.Where(s => (s.CreatedBy == userId || uploadKeys.Contains(s.PhotoKey)) && s.PhotoKey != "")
            .Select(s => s.PhotoKey).ToListAsync(cancellationToken));
        if (keys.Count > 0)
        {
            await objects.EnqueueAsync(keys, cancellationToken);
        }

        // The station stays (shared map data); only its photo goes.
        await db.Stations.Where(s => s.CreatedBy == userId || uploadKeys.Contains(s.PhotoKey))
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.PhotoKey, "")
                .SetProperty(x => x.UpdatedAt, now), cancellationToken);
        await db.Feedings.Where(f => f.PhotoKey != null && uploadKeys.Contains(f.PhotoKey))
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.PhotoKey, (string?)null), cancellationToken);
        await db.AnimalPhotos.Where(p => uploadKeys.Contains(p.Key)).ExecuteDeleteAsync(cancellationToken);
        await db.Uploads.Where(u => u.UserId == userId).ExecuteDeleteAsync(cancellationToken);

        await db.Feedings.Where(f => f.UserId == userId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(f => f.UserId, (Guid?)null)
                .SetProperty(f => f.PhotoKey, (string?)null)
                .SetProperty(f => f.Note, (string?)null)
                .SetProperty(f => f.UpdatedAt, now), cancellationToken);
        await db.Sightings.Where(s => s.UserId == userId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.UserId, (Guid?)null)
                .SetProperty(x => x.Note, (string?)null)
                .SetProperty(x => x.UpdatedAt, now), cancellationToken);
        await db.AnimalPhotos.Where(p => p.CreatedBy == userId).ExecuteDeleteAsync(cancellationToken);
        await db.UrgentPosts.IgnoreQueryFilters().Where(p => p.CreatedBy == userId).ExecuteDeleteAsync(cancellationToken);
        await db.AdoptionRequests.Where(r => r.RequesterId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.AdoptionPosts.Where(p => p.CreatedBy == userId).ExecuteDeleteAsync(cancellationToken);
        await db.Follows.Where(f => f.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.DeviceTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.Reports.Where(r => r.ReporterId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.EmailTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.ExternalLogins.Where(l => l.UserId == userId).ExecuteDeleteAsync(cancellationToken);

        // replaced_by_id points within the user's own tokens; clear it first so the delete never trips the FK.
        await db.RefreshTokens.Where(t => t.UserId == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.ReplacedById, (Guid?)null), cancellationToken);
        await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync(cancellationToken);

        // The transaction id hash stays for refund and fraud handling; only the link to the person goes.
        await db.Subscriptions.Where(s => s.UserId == userId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.UserId, (Guid?)null)
                .SetProperty(x => x.UpdatedAt, now), cancellationToken);

        await db.Users.Where(u => u.Id == userId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.Email, (string?)null)
                .SetProperty(u => u.EmailVerifiedAt, (DateTimeOffset?)null)
                .SetProperty(u => u.PasswordHash, (string?)null)
                .SetProperty(u => u.AppleSub, (string?)null)
                .SetProperty(u => u.DisplayName, DeletedDisplayName)
                .SetProperty(u => u.District, (string?)null)
                .SetProperty(u => u.Role, UserRole.User)
                .SetProperty(u => u.UrgentHome, (GeoPoint?)null)
                .SetProperty(u => u.UrgentOptIn, false)
                .SetProperty(u => u.UrgentRadiusM, DefaultUrgentRadiusM)
                .SetProperty(u => u.TotpSecretEnc, (string?)null)
                .SetProperty(u => u.UpdatedAt, now), cancellationToken);

        await db.DeletionRequests.Where(r => r.Id == requestId)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.CompletedAt, now).SetProperty(r => r.UpdatedAt, now),
                cancellationToken);
        db.AuditLogs.Add(new AuditLog
        {
            ActorId = null,
            Action = AccountPurgeAuditActions.HardDeleted,
            TargetType = "user",
            TargetId = userId,
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();

        await transaction.CommitAsync(cancellationToken);
        logger.LogInformation("Account {UserId} hard deleted; {Keys} object keys queued for removal", userId, keys.Count);
        return true;
    }
}

/// <summary>
/// Removes password registrations that were never verified within <see cref="MaxAge"/>. Such accounts
/// cannot sign in, so they own nothing beyond their email tokens (deleted by cascade). Accounts with an
/// external login, any refresh token or a deletion request are left alone.
/// </summary>
public sealed class UnverifiedAccountCleaner(PatikaDbContext db, TimeProvider clock, ILogger<UnverifiedAccountCleaner> logger)
{
    public static readonly TimeSpan MaxAge = TimeSpan.FromDays(7);

    public async Task<int> RemoveStaleAsync(CancellationToken cancellationToken)
    {
        var cutoff = clock.GetUtcNow() - MaxAge;
        var removed = await db.Users
            .Where(u => u.EmailVerifiedAt == null
                && u.Email != null
                && u.PasswordHash != null
                && u.DeactivatedAt == null
                && u.CreatedAt < cutoff
                && !db.ExternalLogins.Any(l => l.UserId == u.Id)
                && !db.RefreshTokens.Any(t => t.UserId == u.Id)
                && !db.DeletionRequests.Any(r => r.UserId == u.Id))
            .ExecuteDeleteAsync(cancellationToken);
        if (removed > 0)
        {
            db.AuditLogs.Add(new AuditLog
            {
                ActorId = null,
                Action = AccountPurgeAuditActions.UnverifiedRemoved,
                TargetType = "user",
                DetailsJson = $$"""{"count":{{removed}}}""",
            });
            await db.SaveChangesAsync(cancellationToken);
            db.ChangeTracker.Clear();
            logger.LogInformation("Removed {Count} unverified accounts older than {Days} days", removed, MaxAge.TotalDays);
        }

        return removed;
    }
}
