using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Quartz;

namespace Patika.Worker.Jobs.Push;

[DisallowConcurrentExecution]
public sealed class UrgentFanoutJob(UrgentFanout fanout) : IJob
{
    public const string Name = "urgent.fanout";

    public Task Execute(IJobExecutionContext context) => fanout.RunOnceAsync(context.CancellationToken);
}

/// <summary>
/// <c>cost.guard</c>: for each daily budget (non-critical and urgent pushes, non-critical and security emails)
/// alerts once per local day at 80 percent and once at the cap.
/// </summary>
[DisallowConcurrentExecution]
public sealed class CostGuardJob(PushCostGuard guard, ICostAlertNotifier notifier, CostGuardAlertState state) : IJob
{
    public const string Name = "cost.guard";

    public Task Execute(IJobExecutionContext context) => RunOnceAsync(context.CancellationToken);

    public async Task<CostGuardStatus> RunOnceAsync(CancellationToken cancellationToken)
    {
        var status = await guard.StatusAsync(cancellationToken);
        foreach (var usage in status.All)
        {
            if (usage.Level is { } level && state.TryMarkAlerted(status.Day, usage.Kind, level))
            {
                await notifier.AlertAsync(status.Day, usage, level, cancellationToken);
            }
        }

        return status;
    }
}

/// <summary>Remembers, per alert kind and level, the last alerted day for this worker process.</summary>
public sealed class CostGuardAlertState
{
    private readonly Dictionary<(CostAlertKind, CostAlertLevel), DateOnly> alerted = [];
    private readonly Lock gate = new();

    public bool TryMarkAlerted(DateOnly day, CostAlertKind kind, CostAlertLevel level)
    {
        lock (gate)
        {
            if (alerted.TryGetValue((kind, level), out var last) && last == day)
            {
                return false;
            }

            alerted[(kind, level)] = day;
            return true;
        }
    }
}

public static class PushJobsSetup
{
    public static IServiceCollection AddPushServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<PushSettings>().Bind(configuration.GetSection(PushSettings.SectionName)).PostConfigure(settings =>
        {
            settings.CostGuard.DailyCap = configuration.GetValue("CostGuard:MaxPushesPerDay", settings.CostGuard.DailyCap);
            settings.CostGuard.MaxEmailsPerDay = configuration.GetValue("CostGuard:MaxEmailsPerDay", settings.CostGuard.MaxEmailsPerDay);
            settings.CostGuard.MaxCriticalEmailsPerDay = configuration.GetValue(
                "CostGuard:MaxCriticalEmailsPerDay", settings.CostGuard.MaxCriticalEmailsPerDay);
        });
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<ICostAlertNotifier, CostAlertNotifier>();
        services.AddSingleton<CostGuardAlertState>();
        services.AddSingleton<IPushSender>(provider =>
        {
            var settings = provider.GetRequiredService<IOptions<PushSettings>>().Value.Fcm;
            if (!settings.IsConfigured)
            {
                return ActivatorUtilities.CreateInstance<LoggingPushSender>(provider);
            }

            var http = new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
            {
                Timeout = TimeSpan.FromSeconds(10),
            };
            return new FcmPushSender(http, settings, provider.GetRequiredService<TimeProvider>());
        });
        services.AddScoped<IPushCounterStore, PgPushCounterStore>();
        services.AddScoped<PushCostGuard>();
        services.AddScoped<IUrgentFanoutStore, PgUrgentFanoutStore>();
        services.AddScoped<UrgentFanout>();
        return services;
    }

    public static IServiceCollectionQuartzConfigurator AddPushJobs(this IServiceCollectionQuartzConfigurator q)
    {
        var fanout = new JobKey(UrgentFanoutJob.Name);
        q.AddJob<UrgentFanoutJob>(job => job.WithIdentity(fanout));
        q.AddTrigger(trigger => trigger
            .WithIdentity(UrgentFanoutJob.Name + ".interval")
            .ForJob(fanout)
            .StartNow()
            .WithSimpleSchedule(schedule => schedule.WithIntervalInSeconds(15).RepeatForever()));

        var guard = new JobKey(CostGuardJob.Name);
        q.AddJob<CostGuardJob>(job => job.WithIdentity(guard));
        q.AddTrigger(trigger => trigger
            .WithIdentity(CostGuardJob.Name + ".interval")
            .ForJob(guard)
            .StartNow()
            .WithSimpleSchedule(schedule => schedule.WithIntervalInMinutes(5).RepeatForever()));
        return q;
    }
}
