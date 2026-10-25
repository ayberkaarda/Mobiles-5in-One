using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Contracts.Media;
using Quartz;

namespace Patika.Worker.Jobs.Media;

/// <summary><c>media.process</c>: drains <c>incoming/</c> in small batches.</summary>
[DisallowConcurrentExecution]
public sealed class MediaProcessJob(IObjectStore storage, MediaProcessor processor, ILogger<MediaProcessJob> logger) : IJob
{
    public const string Name = "media.process";
    public const int BatchSize = 25;

    public Task Execute(IJobExecutionContext context) => RunOnceAsync(context.CancellationToken);

    public async Task RunOnceAsync(CancellationToken ct)
    {
        var keys = await storage.ListAsync(MediaKeys.IncomingPrefix, BatchSize, ct);
        foreach (var key in keys)
        {
            try
            {
                await processor.ProcessAsync(key, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Storage or database hiccup: the object stays in incoming/ and is retried next run.
                logger.LogWarning("media.process left an object for retry: {ErrorType}", e.GetType().Name);
            }
        }
    }
}

public static class MediaJobsSetup
{
    public static IServiceCollection AddMediaServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<WorkerStorageSettings>().Bind(configuration.GetSection(WorkerStorageSettings.SectionName));
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<IObjectStore, S3ObjectStore>();
        services.AddScoped<IUploadStateStore, PgUploadStateStore>();
        services.AddScoped<MediaProcessor>();
        return services;
    }

    public static IServiceCollectionQuartzConfigurator AddMediaJobs(this IServiceCollectionQuartzConfigurator q)
    {
        var key = new JobKey(MediaProcessJob.Name);
        q.AddJob<MediaProcessJob>(job => job.WithIdentity(key));
        q.AddTrigger(trigger => trigger
            .WithIdentity(MediaProcessJob.Name + ".interval")
            .ForJob(key)
            .StartNow()
            .WithSimpleSchedule(schedule => schedule.WithIntervalInSeconds(20).RepeatForever()));
        return q;
    }
}
