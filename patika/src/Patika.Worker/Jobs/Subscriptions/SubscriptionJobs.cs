using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Patika.Domain.Entities;
using Patika.Infrastructure.Billing;
using Patika.Infrastructure.Persistence;
using Quartz;

namespace Patika.Worker.Jobs.Subscriptions;

public sealed class SubscriptionProcessor(PatikaDbContext db, SubscriptionService subscriptions, TimeProvider clock,
    ILogger<SubscriptionProcessor>? logger = null)
{
    public const int MaxAttempts = 5;
    private readonly ILogger log = logger ?? NullLogger<SubscriptionProcessor>.Instance;

    public async Task<int> ProcessAsync(CancellationToken ct = default)
    {
        var rows = await db.PlayNotifications.Where(x => x.ProcessedAt == null).OrderBy(x => x.ReceivedAt).Take(100).ToListAsync(ct);
        foreach (var row in rows)
        {
            try
            {
                if (row.PurchaseTokenHash is { } hash) await subscriptions.RefreshAsync(hash, row.EventAt, ct);
                row.ProcessedAt = clock.GetUtcNow();
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // One failing delivery must not hold back the rest of the inbox.
                Discard();
                row.Attempts++;
                if (row.Attempts >= MaxAttempts) row.ProcessedAt = clock.GetUtcNow();
                log.LogWarning("Play notification {NotificationId} failed (attempt {Attempt}): {Error}", row.Id, row.Attempts, e.GetType().Name);
            }
            await db.SaveChangesAsync(ct);
        }
        return rows.Count;
    }

    public async Task<int> ReconcileAsync(CancellationToken ct = default)
    {
        // Purged rows keep no token to re-query and no person to entitle.
        var hashes = await db.Subscriptions.AsNoTracking()
            .Where(x => x.Status != SubscriptionStatus.Revoked && x.Status != SubscriptionStatus.Expired
                && x.UserId != null && x.ProtectedPurchaseToken != "")
            .OrderBy(x => x.Id).Select(x => x.PurchaseTokenHash).ToListAsync(ct);
        var done = 0;
        foreach (var hash in hashes)
        {
            try
            {
                await subscriptions.RefreshAsync(hash, clock.GetUtcNow(), ct);
                done++;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                Discard();
                log.LogWarning("Subscription reconcile failed for one row: {Error}", e.GetType().Name);
            }
        }
        return done;
    }

    // A failed refresh may leave tracked subscription or audit changes; only notification rows stay tracked.
    private void Discard()
    {
        foreach (var entry in db.ChangeTracker.Entries().Where(x => x.Entity is not PlayNotification).ToList())
            entry.State = EntityState.Detached;
    }
}

[DisallowConcurrentExecution]
public sealed class ProcessSubscriptionsJob(SubscriptionProcessor processor) : IJob
{
    public Task Execute(IJobExecutionContext context) => processor.ProcessAsync(context.CancellationToken);
}
[DisallowConcurrentExecution]
public sealed class ReconcileSubscriptionsJob(SubscriptionProcessor processor) : IJob
{
    public Task Execute(IJobExecutionContext context) => processor.ReconcileAsync(context.CancellationToken);
}
public static class SubscriptionJobs
{
    public static IServiceCollectionQuartzConfigurator AddSubscriptionJobs(this IServiceCollectionQuartzConfigurator q)
    {
        var process = new JobKey("subscriptions.process");
        q.AddJob<ProcessSubscriptionsJob>(x => x.WithIdentity(process));
        q.AddTrigger(x => x.WithIdentity("subscriptions.process.interval").ForJob(process).StartNow()
            .WithSimpleSchedule(s => s.WithIntervalInSeconds(10).RepeatForever()));
        var reconcile = new JobKey("subscriptions.reconcile");
        q.AddJob<ReconcileSubscriptionsJob>(x => x.WithIdentity(reconcile));
        q.AddTrigger(x => x.WithIdentity("subscriptions.reconcile.daily").ForJob(reconcile)
            .WithCronSchedule("0 0 1 * * ?", c => c.InTimeZone(TimeZoneInfo.Utc)));
        return q;
    }
}
