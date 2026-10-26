using Patika.Infrastructure;
using Patika.Infrastructure.Billing;
using Patika.Worker.Jobs;
using Patika.Worker.Jobs.Accounts;
using Patika.Worker.Jobs.Adoptions;
using Patika.Worker.Jobs.Maintenance;
using Patika.Worker.Jobs.Media;
using Patika.Worker.Jobs.Push;
using Patika.Worker.Jobs.Subscriptions;
using Quartz;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddPatikaInfrastructure(builder.Configuration.GetConnectionString("Patika"));
builder.Services.AddMediaServices(builder.Configuration);
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

await builder.Build().RunAsync();
