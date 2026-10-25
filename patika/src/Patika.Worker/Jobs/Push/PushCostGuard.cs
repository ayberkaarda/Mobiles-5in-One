using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Patika.Infrastructure.Persistence;

namespace Patika.Worker.Jobs.Push;

/// <summary>Daily send counters (proposed table <c>push_daily_counters</c>).</summary>
public interface IPushCounterStore
{
    /// <summary>Atomically adds up to <paramref name="requested"/> without passing <paramref name="cap"/>; returns the amount granted.</summary>
    Task<int> ReserveAsync(DateOnly day, string channel, int requested, int cap, CancellationToken cancellationToken);

    /// <summary>Returns unused grants (sends that did not happen).</summary>
    Task ReleaseAsync(DateOnly day, string channel, int count, CancellationToken cancellationToken);

    Task<int> CountAsync(DateOnly day, string channel, CancellationToken cancellationToken);
}

public sealed class PgPushCounterStore(PatikaDbContext db) : IPushCounterStore
{
    public async Task<int> ReserveAsync(DateOnly day, string channel, int requested, int cap, CancellationToken cancellationToken)
    {
        if (requested <= 0)
        {
            return 0;
        }

        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO push_daily_counters (day, channel, count) VALUES ({day}, {channel}, 0)
            ON CONFLICT (day, channel) DO NOTHING
            """, cancellationToken);
        // The CTE locks the row, so concurrent reservations serialize and the cap is never overrun.
        var granted = await db.Database.SqlQuery<int>($"""
            WITH current AS (
                SELECT count FROM push_daily_counters WHERE day = {day} AND channel = {channel} FOR UPDATE
            )
            UPDATE push_daily_counters AS p SET count = GREATEST(c.count, LEAST(c.count + {requested}, {cap}))
            FROM current AS c
            WHERE p.day = {day} AND p.channel = {channel}
            RETURNING (p.count - c.count) AS "Value"
            """).ToListAsync(cancellationToken);
        return granted.SingleOrDefault();
    }

    public async Task ReleaseAsync(DateOnly day, string channel, int count, CancellationToken cancellationToken)
    {
        if (count <= 0)
        {
            return;
        }

        await db.Database.ExecuteSqlAsync($"""
            UPDATE push_daily_counters SET count = GREATEST(0, count - {count}) WHERE day = {day} AND channel = {channel}
            """, cancellationToken);
    }

    public async Task<int> CountAsync(DateOnly day, string channel, CancellationToken cancellationToken)
    {
        var rows = await db.Database.SqlQuery<int>($"""
            SELECT count AS "Value" FROM push_daily_counters WHERE day = {day} AND channel = {channel}
            """).ToListAsync(cancellationToken);
        return rows.SingleOrDefault();
    }
}

public sealed record CostGuardStatus(DateOnly Day, int Sent, int DailyCap, int CriticalDailyCap)
{
    /// <summary>Non-critical sends are paused.</summary>
    public bool NonCriticalPaused => Sent >= DailyCap;

    public bool CriticalPaused => Sent >= CriticalDailyCap;
}

/// <summary>
/// <c>cost.guard</c>: every push reserves budget from the daily counter first. Non-critical sends stop
/// at <see cref="CostGuardSettings.DailyCap"/>; critical (urgent) sends continue up to
/// <see cref="CostGuardSettings.CriticalDailyCap"/>.
/// </summary>
public sealed class PushCostGuard(IPushCounterStore counters, IOptions<PushSettings> options, TimeProvider clock)
{
    public const string Channel = "push";

    public static DateOnly Today(DateTimeOffset now) => DateOnly.FromDateTime(now.ToOffset(TimeSpan.FromHours(3)).DateTime);

    public Task<int> ReserveAsync(int requested, bool critical, CancellationToken cancellationToken)
    {
        var settings = options.Value.CostGuard;
        var cap = critical ? settings.CriticalDailyCap : settings.DailyCap;
        return counters.ReserveAsync(Today(clock.GetUtcNow()), Channel, requested, cap, cancellationToken);
    }

    public Task ReleaseAsync(int unused, CancellationToken cancellationToken) =>
        counters.ReleaseAsync(Today(clock.GetUtcNow()), Channel, unused, cancellationToken);

    public async Task<CostGuardStatus> StatusAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value.CostGuard;
        var day = Today(clock.GetUtcNow());
        return new CostGuardStatus(day, await counters.CountAsync(day, Channel, cancellationToken), settings.DailyCap, settings.CriticalDailyCap);
    }
}

/// <summary>Raised once per day when the soft cap is crossed; the email sender plugs in here.</summary>
public interface ICostAlertNotifier
{
    Task AlertAsync(CostGuardStatus status, CancellationToken cancellationToken);
}

public sealed class LoggingCostAlertNotifier(ILogger<LoggingCostAlertNotifier> logger) : ICostAlertNotifier
{
    public Task AlertAsync(CostGuardStatus status, CancellationToken cancellationToken)
    {
        logger.LogWarning(
            "cost.guard: {Sent} pushes on {Day} reached the daily cap {Cap}; non-critical sends are paused",
            status.Sent, status.Day, status.DailyCap);
        return Task.CompletedTask;
    }
}
