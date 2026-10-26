using Patika.Infrastructure.Security;

namespace Patika.Api.Email;

public sealed class BudgetedEmailSender(
    IEmailSender inner, IServiceScopeFactory scopes, IConfiguration configuration,
    TimeProvider clock, ILogger<BudgetedEmailSender> logger) : IEmailSender
{
    public IEmailSender Transport => inner;

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var budget = scope.ServiceProvider.GetRequiredService<IDailyEmailBudget>();
        var day = DailySendBudget.Today(clock.GetUtcNow());
        var cap = configuration.GetValue("CostGuard:MaxEmailsPerDay", 5_000);
        if (!await budget.ReserveEmailAsync(day, cap, cancellationToken))
        {
            // Counts only: never include recipient, subject, body or credentials.
            logger.LogWarning("cost.guard: email daily cap {Cap} reached on {Day}; sends paused", cap, day);
            return;
        }
        try
        {
            await inner.SendAsync(message, cancellationToken);
        }
        catch
        {
            await budget.ReleaseEmailAsync(day, CancellationToken.None);
            throw;
        }
    }
}
