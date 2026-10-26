using Microsoft.EntityFrameworkCore;
using Patika.Infrastructure.Persistence;

namespace Patika.Infrastructure.Security;

public interface IDailyEmailBudget
{
    Task<bool> ReserveEmailAsync(DateOnly day, int cap, CancellationToken ct);
    Task ReleaseEmailAsync(DateOnly day, CancellationToken ct);
}

public sealed class DailySendBudget(PatikaDbContext db) : IDailyEmailBudget
{
    public static DateOnly Today(DateTimeOffset now) => DateOnly.FromDateTime(now.ToOffset(TimeSpan.FromHours(3)).DateTime);

    public async Task<bool> ReserveEmailAsync(DateOnly day, int cap, CancellationToken ct)
    {
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO push_daily_counters (day, channel, count) VALUES ({day}, 'email', 0)
            ON CONFLICT (day, channel) DO NOTHING
            """, ct);
        return await db.Database.ExecuteSqlAsync($"""
            UPDATE push_daily_counters SET count = count + 1
            WHERE day = {day} AND channel = 'email' AND count < {Math.Max(0, cap)}
            """, ct) == 1;
    }

    public Task ReleaseEmailAsync(DateOnly day, CancellationToken ct) => db.Database.ExecuteSqlAsync($"""
        UPDATE push_daily_counters SET count = GREATEST(0, count - 1) WHERE day = {day} AND channel = 'email'
        """, ct);
}
