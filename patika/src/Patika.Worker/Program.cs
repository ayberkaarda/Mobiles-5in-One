using Patika.Infrastructure;
using Patika.Worker.Jobs;
using Quartz;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddPatikaInfrastructure(builder.Configuration.GetConnectionString("Patika"));
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
});
builder.Services.AddQuartzHostedService(options => options.WaitForJobsToComplete = true);

await builder.Build().RunAsync();
