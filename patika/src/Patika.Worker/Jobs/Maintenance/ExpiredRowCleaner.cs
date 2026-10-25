using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Infrastructure.Persistence;
using Quartz;

namespace Patika.Worker.Jobs.Maintenance;

/// <summary>
/// Removes rows that can no longer matter: idempotency keys older than 24 hours (the replay window) and
/// email tokens used or expired more than 7 days ago. Deletes in batches so no statement holds locks for long.
/// </summary>
public sealed class ExpiredRowCleaner(PatikaDbContext db, TimeProvider clock, ILogger<ExpiredRowCleaner> logger)
{
    public const int BatchSize = 1000;
    public static readonly TimeSpan IdempotencyRetention = TimeSpan.FromHours(24);
    public static readonly TimeSpan EmailTokenRetention = TimeSpan.FromDays(7);

    public async Task<(int IdempotencyKeys, int EmailTokens)> CleanAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var idempotencyCutoff = now - IdempotencyRetention;
        var tokenCutoff = now - EmailTokenRetention;

        var keys = await DeleteInBatchesAsync(
            () => db.Database.ExecuteSqlAsync(
                $"""
                DELETE FROM idempotency_keys WHERE id IN (
                    SELECT id FROM idempotency_keys WHERE created_at < {idempotencyCutoff} ORDER BY created_at LIMIT {BatchSize})
                """,
                cancellationToken));
        var tokens = await DeleteInBatchesAsync(
            () => db.Database.ExecuteSqlAsync(
                $"""
                DELETE FROM email_tokens WHERE id IN (
                    SELECT id FROM email_tokens
                    WHERE used_at < {tokenCutoff} OR expires_at < {tokenCutoff}
                    ORDER BY created_at LIMIT {BatchSize})
                """,
                cancellationToken));

        if (keys + tokens > 0)
        {
            logger.LogInformation("Maintenance removed {Keys} idempotency keys and {Tokens} email tokens", keys, tokens);
        }

        return (keys, tokens);
    }

    private static async Task<int> DeleteInBatchesAsync(Func<Task<int>> deleteBatch)
    {
        var total = 0;
        int removed;
        do
        {
            removed = await deleteBatch();
            total += removed;
        }
        while (removed == BatchSize);
        return total;
    }
}

[DisallowConcurrentExecution]
public sealed class ExpiredRowCleanupJob(ExpiredRowCleaner cleaner) : IJob
{
    public const string Name = "maintenance.expired_rows";

    public Task Execute(IJobExecutionContext context) => cleaner.CleanAsync(context.CancellationToken);
}

public static class MaintenanceJobs
{
    public static IServiceCollection AddMaintenanceJobServices(this IServiceCollection services)
    {
        services.TryAddSingleton(TimeProvider.System);
        services.AddScoped<ExpiredRowCleaner>();
        return services;
    }

    /// <summary>Hourly, at minute 20.</summary>
    public static IServiceCollectionQuartzConfigurator AddMaintenanceJobs(this IServiceCollectionQuartzConfigurator quartz)
    {
        var key = new JobKey(ExpiredRowCleanupJob.Name);
        quartz.AddJob<ExpiredRowCleanupJob>(job => job.WithIdentity(key));
        quartz.AddTrigger(trigger => trigger
            .WithIdentity(ExpiredRowCleanupJob.Name + ".hourly")
            .ForJob(key)
            .WithCronSchedule("0 20 * * * ?", cron => cron.InTimeZone(TimeZoneInfo.Utc)));
        return quartz;
    }
}
