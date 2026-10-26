using Patika.Infrastructure;
using Patika.Infrastructure.Billing;
using Patika.Infrastructure.Logging;
using Patika.Worker.Jobs;
using Patika.Worker.Jobs.Accounts;
using Patika.Worker.Jobs.Adoptions;
using Patika.Worker.Jobs.Maintenance;
using Patika.Worker.Jobs.Media;
using Patika.Worker.Jobs.Ops;
using Patika.Worker.Jobs.Push;
using Patika.Worker.Jobs.Subscriptions;
using Quartz;

namespace Patika.Worker;

/// <summary>Worker service registrations, shared by <c>Program</c> and the host tests.</summary>
public static class PatikaWorkerHost
{
    public static HostApplicationBuilder AddPatikaWorker(this HostApplicationBuilder builder)
    {
        builder.Services.AddPatikaLogging();
        builder.Services.AddPatikaInfrastructure(builder.Configuration.GetConnectionString("Patika"));
        builder.Services.AddMediaServices(builder.Configuration);
        builder.Services.AddOpsAlerts(builder.Configuration, builder.Environment);
        builder.Services.AddPushServices(builder.Configuration);
        builder.Services.AddAccountJobServices();
        builder.Services.AddPlayBilling(builder.Configuration, builder.Environment.IsDevelopment(), builder.Environment.IsProduction());
        builder.Services.AddScoped<SubscriptionProcessor>();
        builder.Services.AddAdoptionJobServices();
        builder.Services.AddMaintenanceJobServices();
        builder.Services.AddQuartz(options =>
        {
            var heartbeatKey = new JobKey("heartbeat");
            options.AddJob<HeartbeatJob>(job => job.WithIdentity(heartbeatKey));
            options.AddTrigger(trigger => trigger
                .WithIdentity("heartbeat.interval")
                .ForJob(heartbeatKey)
                .StartNow()
                .WithSimpleSchedule(schedule => schedule
                    .WithIntervalInMinutes(1)
                    .RepeatForever()));
            options.AddMediaJobs();
            options.AddPushJobs();
            options.AddAccountJobs();
            options.AddAdoptionJobs();
            options.AddMaintenanceJobs();
            options.AddSubscriptionJobs();
        });
        builder.Services.AddQuartzHostedService(options => options.WaitForJobsToComplete = true);
        return builder;
    }
}
