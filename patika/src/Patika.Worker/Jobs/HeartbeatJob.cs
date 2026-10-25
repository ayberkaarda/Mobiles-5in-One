using Quartz;

namespace Patika.Worker.Jobs;

[DisallowConcurrentExecution]
public sealed class HeartbeatJob : IJob
{
    public Task Execute(IJobExecutionContext context) => Task.CompletedTask;
}
