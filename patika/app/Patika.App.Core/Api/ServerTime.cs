namespace Patika.App.Core.Api;

/// <summary>
/// The server's clock as last seen in a response <c>Date</c> header, carried forward with the monotonic
/// clock, so time-based screens (the feeding cooldown) do not depend on the phone's wall clock, which the
/// user can change or which can simply be wrong.
/// </summary>
public sealed class ServerTime(TimeProvider clock)
{
    private readonly Lock gate = new();
    private DateTimeOffset? server;
    private long observedAt;

    public void Observe(DateTimeOffset? date)
    {
        if (date is not { } value)
        {
            return;
        }

        lock (gate)
        {
            server = value;
            observedAt = clock.GetTimestamp();
        }
    }

    /// <summary>The server's current time, or null before the first response with a <c>Date</c> header.</summary>
    public DateTimeOffset? Now()
    {
        lock (gate)
        {
            return server is { } value ? value + clock.GetElapsedTime(observedAt) : null;
        }
    }
}
