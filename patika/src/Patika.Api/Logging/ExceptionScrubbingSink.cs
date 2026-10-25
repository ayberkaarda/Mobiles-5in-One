using System.Text;
using Serilog.Core;
using Serilog.Events;

namespace Patika.Api.Logging;

/// <summary>
/// Front sink for every configured sink. Exception messages (including inner and aggregate
/// exceptions) can carry user data such as an email in a database error, so each exception is
/// replaced by a <see cref="ScrubbedException"/> holding the type name, the masked message and
/// the stack trace (code locations only) before any sink sees the event.
/// </summary>
public sealed class ExceptionScrubbingSink(IEnumerable<ILogEventSink> sinks) : ILogEventSink, IDisposable
{
    private readonly ILogEventSink[] sinks = [.. sinks];

    public void Emit(LogEvent logEvent)
    {
        var scrubbed = logEvent.Exception is null
            ? logEvent
            : new LogEvent(logEvent.Timestamp, logEvent.Level, ScrubbedException.From(logEvent.Exception),
                logEvent.MessageTemplate, logEvent.Properties.Select(p => new LogEventProperty(p.Key, p.Value)),
                logEvent.TraceId ?? default, logEvent.SpanId ?? default);
        foreach (var sink in sinks)
        {
            sink.Emit(scrubbed);
        }
    }

    public void Dispose()
    {
        foreach (var sink in sinks.OfType<IDisposable>())
        {
            sink.Dispose();
        }
    }
}

public sealed class ScrubbedException : Exception
{
    private readonly string? stackTrace;

    private ScrubbedException(string originalType, string message, string? stackTrace, Exception? inner)
        : base($"{originalType}: {message}", inner)
    {
        OriginalType = originalType;
        this.stackTrace = stackTrace;
    }

    public string OriginalType { get; }

    public override string? StackTrace => stackTrace;

    public static ScrubbedException From(Exception exception, int depth = 0)
    {
        Exception? inner = null;
        if (depth < 8)
        {
            inner = exception is AggregateException { InnerExceptions.Count: > 0 } aggregate
                ? From(aggregate.InnerExceptions[0], depth + 1)
                : exception.InnerException is { } next ? From(next, depth + 1) : null;
        }

        var type = exception is ScrubbedException already ? already.OriginalType : exception.GetType().FullName ?? "Exception";
        var message = exception is ScrubbedException
            ? exception.Message[(type.Length + 2)..]
            : MaskingEnricher.MaskText(exception.Message);
        return new ScrubbedException(type, message, exception.StackTrace, inner);
    }

    public override string ToString()
    {
        var text = new StringBuilder(Message);
        if (InnerException is not null)
        {
            text.Append(" ---> ").Append(InnerException).AppendLine().Append("   --- End of inner exception stack trace ---");
        }

        if (stackTrace is not null)
        {
            text.AppendLine().Append(stackTrace);
        }

        return text.ToString();
    }
}
