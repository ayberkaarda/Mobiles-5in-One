using Patika.Api.Features.Adoptions;
using Quartz;

namespace Patika.Worker.Jobs.Adoptions;

/// <summary><c>adoptions.close</c>: daily, closes expired or adopted posts and their open requests.</summary>
[DisallowConcurrentExecution]
public sealed class AdoptionCloseJob(AdoptionClosureService closure, TimeProvider time, ILogger<AdoptionCloseJob> logger) : IJob
{
    public const string Name = "adoptions.close";

    public async Task Execute(IJobExecutionContext context)
    {
        var closed = await closure.CloseAsync(time.GetUtcNow(), context.CancellationToken);
        logger.LogInformation("{Job} closed {Count} adoption posts", Name, closed);
    }
}

public static class AdoptionJobs
{
    public static IServiceCollection AddAdoptionJobServices(this IServiceCollection services)
    {
        services.AddScoped<AdoptionClosureService>();
        return services;
    }

    /// <summary>Daily at 03:15 Turkey time (00:15 UTC).</summary>
    public static IServiceCollectionQuartzConfigurator AddAdoptionJobs(this IServiceCollectionQuartzConfigurator q)
    {
        var key = new JobKey(AdoptionCloseJob.Name);
        q.AddJob<AdoptionCloseJob>(job => job.WithIdentity(key));
        q.AddTrigger(trigger => trigger
            .WithIdentity(AdoptionCloseJob.Name + ".daily")
            .ForJob(key)
            .WithCronSchedule("0 15 0 * * ?", cron => cron.InTimeZone(TimeZoneInfo.Utc)));
        return q;
    }
}
