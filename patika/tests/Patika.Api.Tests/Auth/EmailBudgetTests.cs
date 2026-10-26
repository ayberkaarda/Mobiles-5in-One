using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Patika.Api.Email;
using Patika.Infrastructure.Security;
using Xunit;

namespace Patika.Api.Tests.Auth;

public sealed class EmailBudgetTests
{
    [Fact]
    public async Task FakeTransportStopsAtCapAndFailedSendsReturnTheirReservation()
    {
        var budget = new MemoryBudget();
        var transport = new Transport();
        using var services = new ServiceCollection().AddSingleton<IDailyEmailBudget>(budget).BuildServiceProvider();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["CostGuard:MaxEmailsPerDay"] = "2"
        }).Build();
        var sender = new BudgetedEmailSender(transport, services.GetRequiredService<IServiceScopeFactory>(), config,
            TimeProvider.System, NullLogger<BudgetedEmailSender>.Instance);
        var message = new EmailMessage("private@example.org", EmailKind.RegistrationAttempt, "private", "secret");
        await Assert.ThrowsAsync<HttpRequestException>(() => sender.SendAsync(message, TestContext.Current.CancellationToken));
        Assert.Equal(0, budget.Count);
        transport.Fail = false;
        await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => sender.SendAsync(message, TestContext.Current.CancellationToken)));
        Assert.Equal(2, transport.Sent);
        Assert.Equal(2, budget.Count);
    }

    private sealed class Transport : IEmailSender
    {
        public bool Fail { get; set; } = true;
        public int Sent;
        public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
        {
            if (Fail) throw new HttpRequestException("simulated outage");
            Interlocked.Increment(ref Sent);
            return Task.CompletedTask;
        }
    }

    private sealed class MemoryBudget : IDailyEmailBudget
    {
        public int Count { get; private set; }
        private readonly Lock gate = new();
        public Task<bool> ReserveEmailAsync(DateOnly day, int cap, CancellationToken ct)
        {
            lock (gate)
            {
                if (Count >= cap) return Task.FromResult(false);
                Count++;
                return Task.FromResult(true);
            }
        }
        public Task ReleaseEmailAsync(DateOnly day, CancellationToken ct)
        {
            lock (gate) Count--;
            return Task.CompletedTask;
        }
    }
}
