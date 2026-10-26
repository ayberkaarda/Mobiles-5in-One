using Microsoft.EntityFrameworkCore;
using Patika.Infrastructure.Persistence;

namespace Patika.Worker.Jobs.Maintenance;

/// <summary>
/// Purchase token retention (docs/release/data-safety.md, ADR-0010): the token hash and the encrypted token are
/// kept for refunds and fraud handling only while they can matter. A subscription row goes 90 days after the
/// subscription ended, or 90 days after the account was purged once the subscription is no longer running (the
/// purge already cut the user link and the encrypted token). Play notifications keep their audit row but lose
/// the token hash after the same 90 days.
/// </summary>
public sealed class BillingTokenRetention(PatikaDbContext db, TimeProvider clock, ILogger<BillingTokenRetention> logger)
{
    public static readonly TimeSpan Retention = TimeSpan.FromDays(90);

    public async Task<(int Subscriptions, int Notifications)> PurgeAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var cutoff = now - Retention;
        var subscriptions = await db.Database.ExecuteSqlAsync(
            $"""
            DELETE FROM subscriptions
            WHERE expires_at < {cutoff} OR (user_id IS NULL AND updated_at < {cutoff} AND expires_at < {now})
            """,
            cancellationToken);
        var notifications = await db.Database.ExecuteSqlAsync(
            $"""
            UPDATE play_notifications SET purchase_token_hash = NULL
            WHERE purchase_token_hash IS NOT NULL AND received_at < {cutoff}
            """,
            cancellationToken);
        if (subscriptions + notifications > 0)
        {
            logger.LogInformation("Billing retention removed {Subscriptions} subscriptions and cleared {Notifications} notification token hashes",
                subscriptions, notifications);
        }

        return (subscriptions, notifications);
    }
}
