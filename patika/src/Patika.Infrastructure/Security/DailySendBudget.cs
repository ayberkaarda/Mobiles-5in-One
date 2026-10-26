using Microsoft.EntityFrameworkCore;
using Patika.Infrastructure.Persistence;

namespace Patika.Infrastructure.Security;

/// <summary>Counter channels in <c>push_daily_counters</c> for the two email budgets.</summary>
public static class EmailBudgetChannels
{
    /// <summary>Non-critical mail; pauses at <c>CostGuard:MaxEmailsPerDay</c>.</summary>
    public const string NonCritical = "email";

    /// <summary>Security-critical mail; its own emergency budget <c>CostGuard:MaxCriticalEmailsPerDay</c>.</summary>
    public const string Critical = "email_critical";
}

public interface IDailyEmailBudget
{
    Task<bool> ReserveEmailAsync(DateOnly day, string channel, int cap, CancellationToken ct);
    Task ReleaseEmailAsync(DateOnly day, string channel, CancellationToken ct);
    Task<int> CountAsync(DateOnly day, string channel, CancellationToken ct);
}

public sealed class DailySendBudget(PatikaDbContext db) : IDailyEmailBudget
{
    public static DateOnly Today(DateTimeOffset now) => DateOnly.FromDateTime(now.ToOffset(TimeSpan.FromHours(3)).DateTime);

    /// <summary>Time from <paramref name="now"/> to the next local midnight (UTC+3), when every daily budget resets.</summary>
    public static TimeSpan UntilNextDay(DateTimeOffset now)
    {
        var offset = TimeSpan.FromHours(3);
        var local = now.ToOffset(offset);
        return new DateTimeOffset(local.Date.AddDays(1), offset) - now;
    }

    public async Task<bool> ReserveEmailAsync(DateOnly day, string channel, int cap, CancellationToken ct)
    {
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO push_daily_counters (day, channel, count) VALUES ({day}, {channel}, 0)
            ON CONFLICT (day, channel) DO NOTHING
            """, ct);
        return await db.Database.ExecuteSqlAsync($"""
            UPDATE push_daily_counters SET count = count + 1
            WHERE day = {day} AND channel = {channel} AND count < {Math.Max(0, cap)}
            """, ct) == 1;
    }

    public Task ReleaseEmailAsync(DateOnly day, string channel, CancellationToken ct) => db.Database.ExecuteSqlAsync($"""
        UPDATE push_daily_counters SET count = GREATEST(0, count - 1) WHERE day = {day} AND channel = {channel}
        """, ct);

    public async Task<int> CountAsync(DateOnly day, string channel, CancellationToken ct)
    {
        var rows = await db.Database.SqlQuery<int>($"""
            SELECT count AS "Value" FROM push_daily_counters WHERE day = {day} AND channel = {channel}
            """).ToListAsync(ct);
        return rows.SingleOrDefault();
    }
}
