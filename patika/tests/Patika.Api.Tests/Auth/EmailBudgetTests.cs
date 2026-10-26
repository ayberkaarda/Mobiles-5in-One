using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Patika.Api.Email;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Patika.Infrastructure.Security;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests.Auth;

public sealed class EmailBudgetTests
{
    private static readonly DateTimeOffset Noon = new(2026, 10, 25, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void EveryKindIsClassifiedAndOnlyOpsAlertsAreNonCritical()
    {
        foreach (var kind in Enum.GetValues<EmailKind>())
        {
            Assert.Equal(kind != EmailKind.OpsAlert, EmailKinds.IsCritical(kind));
        }
    }

    [Fact]
    public async Task FakeTransportStopsAtCapAndFailedSendsReturnTheirReservation()
    {
        var (sender, budget, transport) = Create(nonCritical: 2, critical: 0);
        var message = new EmailMessage("ops@example.org", EmailKind.OpsAlert, "private", "secret");
        await Assert.ThrowsAsync<HttpRequestException>(() => sender.SendAsync(message, Ct));
        Assert.Equal(0, budget.Count(EmailBudgetChannels.NonCritical));
        transport.Fail = false;
        var results = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => sender.SendAsync(message, Ct)));
        Assert.Equal(2, transport.Sent);
        Assert.Equal(2, budget.Count(EmailBudgetChannels.NonCritical));
        Assert.Equal(2, results.Count(r => r.Status == EmailSendStatus.Sent));
        Assert.All(results.Where(r => r.Status != EmailSendStatus.Sent), r =>
        {
            Assert.Equal(EmailSendStatus.SkippedDailyCap, r.Status);
            Assert.True(r.Skipped);
        });
    }

    [Fact]
    public async Task SecurityMailIsNeverBlockedByTheNonCriticalCap()
    {
        var (sender, budget, transport) = Create(nonCritical: 0, critical: 50);
        transport.Fail = false;

        var skipped = await sender.SendAsync(new EmailMessage("ops@example.org", EmailKind.OpsAlert, "s", "b"), Ct);
        Assert.Equal(EmailSendStatus.SkippedDailyCap, skipped.Status);
        Assert.NotNull(await sender.PausedForAsync(EmailKind.OpsAlert, Ct));

        foreach (var kind in new[] { EmailKind.VerifyEmail, EmailKind.PasswordReset, EmailKind.RegistrationAttempt, EmailKind.DeletionScheduled })
        {
            Assert.Null(await sender.PausedForAsync(kind, Ct));
            var result = await sender.SendAsync(new EmailMessage($"{kind}@example.org", kind, "s", "b"), Ct);
            Assert.Equal(EmailSendStatus.Sent, result.Status);
        }

        Assert.Equal(4, transport.Sent);
        Assert.Equal(4, budget.Count(EmailBudgetChannels.Critical));
        Assert.Equal(0, budget.Count(EmailBudgetChannels.NonCritical));
    }

    [Fact]
    public async Task TheCriticalBudgetHasItsOwnCapAndReportsWhenItResets()
    {
        var (sender, _, transport) = Create(nonCritical: 1_000, critical: 3);
        transport.Fail = false;
        for (var i = 0; i < 3; i++)
        {
            Assert.Equal(EmailSendStatus.Sent, (await sender.SendAsync(Verification($"k{i}@example.org"), Ct)).Status);
        }

        var skipped = await sender.SendAsync(Verification("late@example.org"), Ct);

        // 09:00 UTC is 12:00 local (UTC+3): the budget resets at local midnight, 12 hours later.
        Assert.Equal(new EmailSendResult(EmailSendStatus.SkippedDailyCap, TimeSpan.FromHours(12)), skipped);
        Assert.Equal(TimeSpan.FromHours(12), await sender.PausedForAsync(EmailKind.PasswordReset, Ct));
        Assert.Null(await sender.PausedForAsync(EmailKind.OpsAlert, Ct));
        Assert.Equal(3, transport.Sent);
    }

    [Fact]
    public async Task OneRecipientGetsAtMostTenSecurityMailsPerDay()
    {
        var (sender, budget, transport) = Create(nonCritical: 1_000, critical: 1_000);
        transport.Fail = false;
        var results = new List<EmailSendResult>();
        for (var i = 0; i < 11; i++)
        {
            results.Add(await sender.SendAsync(Verification(i % 2 == 0 ? "victim@example.org" : " VICTIM@example.org "), Ct));
        }

        Assert.Equal(10, results.Count(r => r.Status == EmailSendStatus.Sent));
        Assert.Equal(EmailSendStatus.SkippedRecipientLimit, results[^1].Status);
        Assert.NotNull(results[^1].RetryAfter);
        Assert.Equal(10, budget.Count(EmailBudgetChannels.Critical));
        Assert.Equal(EmailSendStatus.Sent, (await sender.SendAsync(Verification("other@example.org"), Ct)).Status);
    }

    [Fact]
    public async Task RegisterAnswers503WithRetryAfterWhenTheCodeIsSkipped()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient("198.51.100.60");
        factory.Outbox.NextResult = new EmailSendResult(EmailSendStatus.SkippedDailyCap, TimeSpan.FromMinutes(90));

        using var response = await client.PostRegisterAsync(NewEmail("kayit"));

        await AssertEmailUnavailableAsync(response, 5_400);
        Assert.Empty(factory.Outbox.Messages);
    }

    [Fact]
    public async Task PausedSecurityMailGivesEveryAddressThe503BeforeAnythingHappens()
    {
        await using var factory = new PatikaApiFactory();
        using var setup = factory.CreateApiClient("198.51.100.61");
        var known = NewEmail("bilinen");
        await setup.RegisterAsync(factory, known);
        var sentBefore = factory.Outbox.Messages.Count;
        factory.Outbox.PausedFor = TimeSpan.FromSeconds(30);

        using var client = factory.CreateApiClient("198.51.100.62");
        using var forgotKnown = await client.PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest(known), Ct);
        using var forgotUnknown = await client.PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest(NewEmail("yok")), Ct);
        using var resend = await client.ResendVerificationAsync(NewEmail("bekleyen"));
        using var register = await client.PostRegisterAsync(NewEmail("yeni"));

        foreach (var response in new[] { forgotKnown, forgotUnknown, resend, register })
        {
            await AssertEmailUnavailableAsync(response, 30);
        }

        Assert.Equal(sentBefore, factory.Outbox.Messages.Count);
        Assert.Single(factory.Store.Users);
    }

    [Fact]
    public async Task WithTheRealBudgetANonCriticalCapOfZeroStillLetsUsersRegisterAndVerify()
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["CostGuard:MaxEmailsPerDay"] = "0";
        factory.Settings["CostGuard:MaxCriticalEmailsPerDay"] = "1";
        var budget = new MemoryBudget();
        factory.ExtraServices = services =>
        {
            services.RemoveAll<IDailyEmailBudget>();
            services.AddSingleton<IDailyEmailBudget>(budget);
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(provider => new BudgetedEmailSender(factory.Outbox,
                provider.GetRequiredService<IServiceScopeFactory>(), provider.GetRequiredService<IConfiguration>(),
                TimeProvider.System, provider.GetRequiredService<ILogger<BudgetedEmailSender>>()));
        };
        using var client = factory.CreateApiClient("198.51.100.63");

        var tokens = await client.RegisterAsync(factory, NewEmail("ilk"));
        using var second = await client.PostRegisterAsync(NewEmail("ikinci"));

        Assert.False(string.IsNullOrEmpty(tokens.AccessToken));
        Assert.Equal(1, budget.Count(EmailBudgetChannels.Critical));
        await AssertEmailUnavailableAsync(second, null);
    }

    private static async Task AssertEmailUnavailableAsync(HttpResponseMessage response, int? retryAfterSeconds)
    {
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var retryAfter = Assert.Single(response.Headers.GetValues("Retry-After"));
        if (retryAfterSeconds is { } seconds)
        {
            Assert.Equal(seconds.ToString(System.Globalization.CultureInfo.InvariantCulture), retryAfter);
        }

        Assert.Equal(AuthErrorCodes.EmailUnavailable, (await response.ReadProblemAsync()).Code);
    }

    private static EmailMessage Verification(string to) => new(to, EmailKind.VerifyEmail, "s", "123456");

    private static (BudgetedEmailSender Sender, MemoryBudget Budget, Transport Transport) Create(int nonCritical, int critical)
    {
        var budget = new MemoryBudget();
        var transport = new Transport();
        var services = new ServiceCollection().AddSingleton<IDailyEmailBudget>(budget).BuildServiceProvider();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["CostGuard:MaxEmailsPerDay"] = nonCritical.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["CostGuard:MaxCriticalEmailsPerDay"] = critical.ToString(System.Globalization.CultureInfo.InvariantCulture),
        }).Build();
        var sender = new BudgetedEmailSender(transport, services.GetRequiredService<IServiceScopeFactory>(), config,
            new FixedTime(Noon), NullLogger<BudgetedEmailSender>.Instance);
        return (sender, budget, transport);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class Transport : IEmailSender
    {
        public bool Fail { get; set; } = true;
        public int Sent;
        public Task<EmailSendResult> SendAsync(EmailMessage message, CancellationToken cancellationToken)
        {
            if (Fail) throw new HttpRequestException("simulated outage");
            Interlocked.Increment(ref Sent);
            return Task.FromResult(EmailSendResult.Sent);
        }
    }

    private sealed class MemoryBudget : IDailyEmailBudget
    {
        private readonly Dictionary<string, int> counts = new(StringComparer.Ordinal);
        private readonly Lock gate = new();

        public int Count(string channel)
        {
            lock (gate) return counts.GetValueOrDefault(channel);
        }

        public Task<bool> ReserveEmailAsync(DateOnly day, string channel, int cap, CancellationToken ct)
        {
            lock (gate)
            {
                if (counts.GetValueOrDefault(channel) >= cap) return Task.FromResult(false);
                counts[channel] = counts.GetValueOrDefault(channel) + 1;
                return Task.FromResult(true);
            }
        }

        public Task ReleaseEmailAsync(DateOnly day, string channel, CancellationToken ct)
        {
            lock (gate) counts[channel] = Math.Max(0, counts.GetValueOrDefault(channel) - 1);
            return Task.CompletedTask;
        }

        public Task<int> CountAsync(DateOnly day, string channel, CancellationToken ct) => Task.FromResult(Count(channel));
    }
}
