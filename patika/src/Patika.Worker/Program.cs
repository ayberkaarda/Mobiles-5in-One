using Patika.Infrastructure;
using Patika.Worker.Jobs;
using Patika.Worker.Jobs.Accounts;
using Patika.Worker.Jobs.Adoptions;
using Patika.Worker.Jobs.Media;
using Patika.Worker.Jobs.Push;
using Quartz;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddPatikaInfrastructure(builder.Configuration.GetConnectionString("Patika"));
builder.Services.AddMediaServices(builder.Configuration);
builder.Services.AddPushServices(builder.Configuration);
builder.Services.AddAccountJobServices();
builder.Services.AddAdoptionJobServices();
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
});
builder.Services.AddQuartzHostedService(options => options.WaitForJobsToComplete = true);

await builder.Build().RunAsync();
