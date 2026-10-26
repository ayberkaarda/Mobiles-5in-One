using Microsoft.Extensions.DependencyInjection;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Compact;

namespace Patika.Infrastructure.Logging;

/// <summary>One logging pipeline for the API, the Worker and the Web (docs/ops/logging.md).</summary>
public static class PatikaLogging
{
    /// <summary>
    /// Every sink (console plus any registered in DI, such as test capture) sits behind the exception
    /// scrubber, and the masking enricher runs last, so no sink sees raw user data.
    /// </summary>
    public static IServiceCollection AddPatikaLogging(this IServiceCollection services) =>
        services.AddSerilog((provider, logger) => logger
            .MinimumLevel.Information()
            .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
            .MinimumLevel.Override("System", LogEventLevel.Warning)
            .MinimumLevel.Override("Quartz", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .Enrich.With<MaskingEnricher>()
            .WriteTo.Sink(new ExceptionScrubbingSink(
            [
                .. provider.GetServices<ILogEventSink>(),
                new LoggerConfiguration().WriteTo.Console(new RenderedCompactJsonFormatter()).CreateLogger(),
            ])),
            preserveStaticLogger: true);
}
