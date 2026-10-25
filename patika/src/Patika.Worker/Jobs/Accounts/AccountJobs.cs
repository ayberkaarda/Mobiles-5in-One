using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Worker.Jobs.Media;
using Quartz;

namespace Patika.Worker.Jobs.Accounts;

[DisallowConcurrentExecution]
public sealed class AccountHardDeleteJob(AccountPurger purger) : IJob
{
    public Task Execute(IJobExecutionContext context) => purger.PurgeDueAsync(context.CancellationToken);
}

[DisallowConcurrentExecution]
public sealed class UnverifiedAccountCleanupJob(UnverifiedAccountCleaner cleaner) : IJob
{
    public Task Execute(IJobExecutionContext context) => cleaner.RemoveStaleAsync(context.CancellationToken);
}

public static class AccountJobs
{
    public const string HardDeleteJobName = "deletion.hard_delete";
    public const string UnverifiedCleanupJobName = "accounts.unverified_cleanup";

    /// <summary>
    /// Services for the account jobs. Photo keys go to <see cref="ObjectStoreKeyRemoval"/> unless another
    /// <see cref="IObjectKeyRemovalQueue"/> is registered first; it needs the media slice's <see cref="IObjectStore"/>.
    /// </summary>
    public static IServiceCollection AddAccountJobServices(this IServiceCollection services)
    {
        services.TryAddSingleton(TimeProvider.System);
        services.AddScoped<AccountPurger>();
        services.AddScoped<UnverifiedAccountCleaner>();
        services.TryAddScoped<IObjectKeyRemovalQueue, ObjectStoreKeyRemoval>();
        return services;
    }

    /// <summary>Hard delete every 15 minutes; unverified cleanup daily at 03:30 Turkey time (00:30 UTC).</summary>
    public static IServiceCollectionQuartzConfigurator AddAccountJobs(this IServiceCollectionQuartzConfigurator quartz)
    {
        var hardDelete = new JobKey(HardDeleteJobName);
        quartz.AddJob<AccountHardDeleteJob>(job => job.WithIdentity(hardDelete));
        quartz.AddTrigger(trigger => trigger
            .WithIdentity(HardDeleteJobName + ".interval")
            .ForJob(hardDelete)
            .StartNow()
            .WithSimpleSchedule(schedule => schedule.WithIntervalInMinutes(15).RepeatForever()));

        var cleanup = new JobKey(UnverifiedCleanupJobName);
        quartz.AddJob<UnverifiedAccountCleanupJob>(job => job.WithIdentity(cleanup));
        quartz.AddTrigger(trigger => trigger
            .WithIdentity(UnverifiedCleanupJobName + ".daily")
            .ForJob(cleanup)
            .WithCronSchedule("0 30 0 * * ?", cron => cron.InTimeZone(TimeZoneInfo.Utc)));
        return quartz;
    }
}

/// <summary>
/// Default removal: deletes every physical object of each photo key (original, quarantine copy, all
/// renditions) straight away. Deleting a missing object is a no-op, so a retried purge is safe.
/// </summary>
public sealed class ObjectStoreKeyRemoval(IObjectStore store) : IObjectKeyRemovalQueue
{
    public static readonly IReadOnlyList<int> RenditionWidths = [ImageSanitizer.MediumEdge, ImageSanitizer.SmallEdge];

    public async Task EnqueueAsync(IReadOnlyCollection<string> keys, CancellationToken cancellationToken)
    {
        foreach (var objectKey in keys.SelectMany(key => PhotoObjects.For(key, RenditionWidths)))
        {
            await store.DeleteAsync(objectKey, cancellationToken);
        }
    }
}
