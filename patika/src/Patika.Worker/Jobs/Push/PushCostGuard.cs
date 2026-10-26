using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Patika.Infrastructure.Persistence;
using Patika.Infrastructure.Security;
using Patika.Worker.Jobs.Ops;

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

public enum CostAlertKind { Push, UrgentPush, Email, CriticalEmail }

public enum CostAlertLevel { Warning, Paused }

/// <summary>One daily budget: how much of its cap is used.</summary>
public sealed record BudgetUsage(CostAlertKind Kind, int Used, int Cap)
{
    public const int WarningPercent = 80;

    public bool Paused => Used >= Cap;

    /// <summary>Null below <see cref="WarningPercent"/> of the cap.</summary>
    public CostAlertLevel? Level => Paused ? CostAlertLevel.Paused
        : (long)Used * 100 >= (long)Cap * WarningPercent ? CostAlertLevel.Warning
        : null;
}

public sealed record CostGuardStatus(DateOnly Day, BudgetUsage Push, BudgetUsage UrgentPush, BudgetUsage Email, BudgetUsage CriticalEmail)
{
    /// <summary>Non-critical pushes are paused.</summary>
    public bool NonCriticalPaused => Push.Paused;

    /// <summary>Urgent fan-out is deferred to the next local day.</summary>
    public bool CriticalPaused => UrgentPush.Paused;

    /// <summary>Non-critical emails are paused.</summary>
    public bool EmailsPaused => Email.Paused;

    /// <summary>Security emails are paused; the API answers 503 <c>email_unavailable</c>.</summary>
    public bool CriticalEmailsPaused => CriticalEmail.Paused;

    public IEnumerable<BudgetUsage> All => [Push, UrgentPush, Email, CriticalEmail];
}

/// <summary>Why an urgent reservation granted less than it asked for.</summary>
public enum UrgentLimit { None, Author, Daily }

public sealed record UrgentGrant(int Granted, UrgentLimit LimitedBy);

/// <summary>
/// <c>cost.guard</c>: every push reserves budget from a daily counter first. Non-critical sends use channel
/// <see cref="Channel"/> and stop at <see cref="CostGuardSettings.DailyCap"/>. Urgent fan-out has its own counter
/// <see cref="UrgentChannel"/> up to <see cref="CostGuardSettings.CriticalDailyCap"/>, so non-critical traffic can never
/// use it up, plus a per-author daily device budget (<see cref="PushSettings.MaxDevicesPerAuthorPerDay"/>).
/// </summary>
public sealed class PushCostGuard(IPushCounterStore counters, IOptions<PushSettings> options, TimeProvider clock)
{
    public const string Channel = "push";
    public const string UrgentChannel = "push_urgent";
    public const string EmailChannel = EmailBudgetChannels.NonCritical;
    public const string CriticalEmailChannel = EmailBudgetChannels.Critical;

    public static DateOnly Today(DateTimeOffset now) => DateOnly.FromDateTime(now.ToOffset(TimeSpan.FromHours(3)).DateTime);

    /// <summary>The start of the next local day (UTC+3), when every daily budget resets.</summary>
    public static DateTimeOffset NextDay(DateTimeOffset now) => now + DailySendBudget.UntilNextDay(now);

    public static string AuthorChannel(Guid authorId) => "push_author:" + authorId.ToString("N");

    public Task<int> ReserveAsync(int requested, bool critical, CancellationToken cancellationToken)
    {
        var settings = options.Value.CostGuard;
        var day = Today(clock.GetUtcNow());
        return critical
            ? counters.ReserveAsync(day, UrgentChannel, requested, settings.CriticalDailyCap, cancellationToken)
            : counters.ReserveAsync(day, Channel, requested, settings.DailyCap, cancellationToken);
    }

    public Task ReleaseAsync(int unused, bool critical, CancellationToken cancellationToken) =>
        counters.ReleaseAsync(Today(clock.GetUtcNow()), critical ? UrgentChannel : Channel, unused, cancellationToken);

    /// <summary>Reserves urgent sends for one author's post: the author's daily device budget first, then the urgent counter.</summary>
    public async Task<UrgentGrant> ReserveUrgentAsync(Guid authorId, int requested, CancellationToken cancellationToken)
    {
        if (requested <= 0)
        {
            return new UrgentGrant(0, UrgentLimit.None);
        }

        var day = Today(clock.GetUtcNow());
        var author = AuthorChannel(authorId);
        var byAuthor = await counters.ReserveAsync(day, author, requested, Math.Max(0, options.Value.MaxDevicesPerAuthorPerDay), cancellationToken);
        var granted = await counters.ReserveAsync(day, UrgentChannel, byAuthor, options.Value.CostGuard.CriticalDailyCap, cancellationToken);
        await counters.ReleaseAsync(day, author, byAuthor - granted, cancellationToken);
        var limit = granted == requested ? UrgentLimit.None : granted < byAuthor ? UrgentLimit.Daily : UrgentLimit.Author;
        return new UrgentGrant(granted, limit);
    }

    /// <summary>Returns urgent grants that were not used (failed sends) to both counters.</summary>
    public async Task ReleaseUrgentAsync(Guid authorId, int unused, CancellationToken cancellationToken)
    {
        var day = Today(clock.GetUtcNow());
        await counters.ReleaseAsync(day, UrgentChannel, unused, cancellationToken);
        await counters.ReleaseAsync(day, AuthorChannel(authorId), unused, cancellationToken);
    }

    public async Task<CostGuardStatus> StatusAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value.CostGuard;
        var day = Today(clock.GetUtcNow());
        async Task<BudgetUsage> Usage(CostAlertKind kind, string channel, int cap) =>
            new(kind, await counters.CountAsync(day, channel, cancellationToken), cap);
        return new CostGuardStatus(day,
            await Usage(CostAlertKind.Push, Channel, settings.DailyCap),
            await Usage(CostAlertKind.UrgentPush, UrgentChannel, settings.CriticalDailyCap),
            await Usage(CostAlertKind.Email, EmailChannel, settings.MaxEmailsPerDay),
            await Usage(CostAlertKind.CriticalEmail, CriticalEmailChannel, settings.MaxCriticalEmailsPerDay));
    }
}

/// <summary>Raised at most once per local day, kind and level (80 percent, then the cap).</summary>
public interface ICostAlertNotifier
{
    Task AlertAsync(DateOnly day, BudgetUsage usage, CostAlertLevel level, CancellationToken cancellationToken);
}

/// <summary>Writes the masked, count-only alert line and mails the same text to <c>Ops:AlertEmail</c>.</summary>
public sealed class CostAlertNotifier(ILogger<CostAlertNotifier> logger, IOpsAlerts alerts) : ICostAlertNotifier
{
    public Task AlertAsync(DateOnly day, BudgetUsage usage, CostAlertLevel level, CancellationToken cancellationToken)
    {
        var name = Name(usage.Kind);
        var effect = Effect(usage.Kind, level);
        logger.LogWarning("cost.guard: {Budget} at {Used} of {Cap} on {Day} ({Level}); {Effect}",
            name, usage.Used, usage.Cap, day, level, effect);
        var subject = level == CostAlertLevel.Paused ? $"cost.guard: {name} cap reached" : $"cost.guard: {name} at 80%";
        return alerts.RaiseAsync(subject, string.Create(CultureInfo.InvariantCulture,
            $"{usage.Used} of {usage.Cap} {name} used on {day:yyyy-MM-dd}; {effect}."), cancellationToken);
    }

    internal static string Name(CostAlertKind kind) => kind switch
    {
        CostAlertKind.Push => "non-critical pushes",
        CostAlertKind.UrgentPush => "urgent pushes",
        CostAlertKind.Email => "non-critical emails",
        _ => "security emails",
    };

    private static string Effect(CostAlertKind kind, CostAlertLevel level) => (kind, level) switch
    {
        (_, CostAlertLevel.Warning) => "the budget pauses at the cap",
        (CostAlertKind.Push, _) => "non-critical sends are paused until the next local day",
        (CostAlertKind.UrgentPush, _) => "urgent fan-out is deferred to the next local day",
        (CostAlertKind.Email, _) => "non-critical email is paused until the next local day",
        _ => "verification, reset and deletion emails are paused and the API answers 503 email_unavailable until the next local day",
    };
}
