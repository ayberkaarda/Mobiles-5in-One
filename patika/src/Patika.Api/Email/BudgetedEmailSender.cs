using Patika.Api.Security.RateLimiting;
using Patika.Infrastructure.Security;

namespace Patika.Api.Email;

/// <summary>
/// Wraps every transport with the daily budgets. Non-critical kinds pause at
/// <c>CostGuard:MaxEmailsPerDay</c>. Security-critical kinds (<see cref="EmailKinds.IsCritical"/>) never
/// count against that cap: they draw on their own emergency budget <c>CostGuard:MaxCriticalEmailsPerDay</c>
/// and on <see cref="MaxCriticalPerRecipientPerDay"/> per address, on top of the per-IP and per-address
/// request limits. A skipped message is reported to the caller, never swallowed.
/// </summary>
public sealed class BudgetedEmailSender(
    IEmailSender inner, IServiceScopeFactory scopes, IConfiguration configuration,
    TimeProvider clock, ILogger<BudgetedEmailSender> logger) : IEmailSender, IDisposable
{
    public const int DefaultMaxEmailsPerDay = 5_000;
    public const int DefaultMaxCriticalEmailsPerDay = 20_000;

    /// <summary>Matches the persistent cap of 10 codes per user and purpose per 24 hours.</summary>
    public const int MaxCriticalPerRecipientPerDay = 10;

    private readonly KeyedRateLimiter recipients = new(MaxCriticalPerRecipientPerDay, TimeSpan.FromHours(24), 24);

    public IEmailSender Transport => inner;

    public async Task<EmailSendResult> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        var critical = EmailKinds.IsCritical(message.Kind);
        var (channel, cap) = Budget(critical);
        var now = clock.GetUtcNow();
        var day = DailySendBudget.Today(now);
        await using var scope = scopes.CreateAsyncScope();
        var budget = scope.ServiceProvider.GetRequiredService<IDailyEmailBudget>();
        if (!await budget.ReserveEmailAsync(day, channel, cap, cancellationToken))
        {
            // Counts only: never include recipient, subject, body or credentials.
            logger.LogWarning("cost.guard: {Channel} daily cap {Cap} reached on {Day}; a message of kind {Kind} was not sent",
                channel, cap, day, message.Kind);
            return new EmailSendResult(EmailSendStatus.SkippedDailyCap, DailySendBudget.UntilNextDay(now));
        }

        if (critical && recipients.TryAcquire(message.To.Trim().ToUpperInvariant()) is { } retryAfter)
        {
            await budget.ReleaseEmailAsync(day, channel, CancellationToken.None);
            logger.LogWarning("Daily critical email limit {Limit} reached for one recipient; a message of kind {Kind} was not sent",
                MaxCriticalPerRecipientPerDay, message.Kind);
            return new EmailSendResult(EmailSendStatus.SkippedRecipientLimit, retryAfter);
        }

        try
        {
            return await inner.SendAsync(message, cancellationToken);
        }
        catch
        {
            await budget.ReleaseEmailAsync(day, channel, CancellationToken.None);
            throw;
        }
    }

    public async Task<TimeSpan?> PausedForAsync(EmailKind kind, CancellationToken cancellationToken)
    {
        var (channel, cap) = Budget(EmailKinds.IsCritical(kind));
        var now = clock.GetUtcNow();
        await using var scope = scopes.CreateAsyncScope();
        var budget = scope.ServiceProvider.GetRequiredService<IDailyEmailBudget>();
        return await budget.CountAsync(DailySendBudget.Today(now), channel, cancellationToken) >= cap
            ? DailySendBudget.UntilNextDay(now)
            : null;
    }

    public void Dispose() => recipients.Dispose();

    private (string Channel, int Cap) Budget(bool critical) => critical
        ? (EmailBudgetChannels.Critical, Math.Max(0, configuration.GetValue("CostGuard:MaxCriticalEmailsPerDay", DefaultMaxCriticalEmailsPerDay)))
        : (EmailBudgetChannels.NonCritical, Math.Max(0, configuration.GetValue("CostGuard:MaxEmailsPerDay", DefaultMaxEmailsPerDay)));
}
