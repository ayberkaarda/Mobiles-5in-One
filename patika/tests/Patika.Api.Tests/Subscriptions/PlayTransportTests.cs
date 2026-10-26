using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Patika.Domain.Entities;
using Patika.Infrastructure.Billing;
using Xunit;

namespace Patika.Api.Tests.Subscriptions;

public sealed class PlayTransportTests
{
    [Fact]
    public async Task GoogleTransportUsesV2ReadAndSubscriptionAcknowledgementWithBearer()
    {
        var handler = new RecordingHandler();
        using var http = new HttpClient(handler);
        var play = new GooglePlayDeveloperApi(http, new TestBearer());
        var purchase = await play.GetSubscriptionV2(BillingTokens.Package, "test-token", TestContext.Current.CancellationToken);
        Assert.Equal("aylik", purchase.LineItems.Single().OfferDetails?.BasePlanId);
        Assert.NotNull(purchase.TestPurchase);
        Assert.Equal("acct-1", purchase.ExternalAccountIdentifiers?.ObfuscatedExternalAccountId);
        await play.Acknowledge(BillingTokens.Package, BillingTokens.Product, "test-token", TestContext.Current.CancellationToken);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal("GET /androidpublisher/v3/applications/app.patika.android/purchases/subscriptionsv2/tokens/test-token", handler.Requests[0]);
        Assert.Equal("POST /androidpublisher/v3/applications/app.patika.android/purchases/subscriptions/patika_destekci/tokens/test-token:acknowledge", handler.Requests[1]);
    }

    [Theory]
    [InlineData(SubscriptionStatus.Active, true)]
    [InlineData(SubscriptionStatus.InGracePeriod, true)]
    [InlineData(SubscriptionStatus.Canceled, true)]
    [InlineData(SubscriptionStatus.OnHold, false)]
    [InlineData(SubscriptionStatus.Paused, false)]
    [InlineData(SubscriptionStatus.Expired, false)]
    [InlineData(SubscriptionStatus.Revoked, false)]
    public void EntitlementRequiresAnAllowedStateAndFutureExpiry(SubscriptionStatus status, bool expected)
    {
        var now = DateTimeOffset.UtcNow;
        var row = new Subscription { PurchaseTokenHash = "test", ProductId = BillingTokens.Product, Status = status, ExpiresAt = now.AddDays(1), Environment = BillingEnvironment.Production };
        Assert.Equal(expected, SubscriptionService.HasEntitlement(row, now, allowTestPurchases: false));
        row.Environment = BillingEnvironment.Test;
        Assert.Equal(expected, SubscriptionService.HasEntitlement(row, now, allowTestPurchases: true));
        Assert.False(SubscriptionService.HasEntitlement(row, now, allowTestPurchases: false));
        row.ExpiresAt = now;
        Assert.False(SubscriptionService.HasEntitlement(row, now, allowTestPurchases: true));
    }

    [Fact]
    public async Task GoogleTransportKeepsPurchaseTokensOutOfHttpClientLogs()
    {
        const string token = "secret-purchase-token-123";
        var sink = new LogSink();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Billing:Provider"] = "Google", ["Billing:PackageName"] = BillingTokens.Package, ["Billing:Google:AccessToken"] = "test-bearer" }).Build();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(config);
        services.AddLogging(b => b.SetMinimumLevel(LogLevel.Trace).AddProvider(sink));
        services.AddPlayBilling(config, false);
        services.AddHttpClient(nameof(IPlayDeveloperApi)).ConfigurePrimaryHttpMessageHandler(() => new RecordingHandler());
        await using var provider = services.BuildServiceProvider();
        var play = provider.GetRequiredService<IPlayDeveloperApi>();
        await play.GetSubscriptionV2(BillingTokens.Package, token, TestContext.Current.CancellationToken);
        await play.Acknowledge(BillingTokens.Package, BillingTokens.Product, token, TestContext.Current.CancellationToken);
        Assert.IsType<GooglePlayDeveloperApi>(play);
        Assert.DoesNotContain(sink.Messages, m => m.Contains(token, StringComparison.Ordinal));
    }

    [Fact]
    public void GoogleClientHasABoundedTimeoutAndNeedsThePackageName()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Billing:Provider"] = "Google", ["Billing:PackageName"] = BillingTokens.Package }).Build();
        var services = new ServiceCollection();
        services.AddPlayBilling(config, false);
        using var provider = services.BuildServiceProvider();
        using var client = provider.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(IPlayDeveloperApi));
        Assert.Equal(TimeSpan.FromSeconds(10), client.Timeout);

        var missing = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Billing:Provider"] = "Google" }).Build();
        Assert.Throws<InvalidOperationException>(() => new ServiceCollection().AddPlayBilling(missing, false));
    }

    [Theory]
    [InlineData(false, null, false)]
    [InlineData(false, "true", true)]
    [InlineData(true, null, true)]
    public void FakeOutsideDevelopmentNeedsAnExplicitAllowance(bool development, string? allowFake, bool starts)
    {
        // Staging is not Production, but it is not Development either.
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Billing:Provider"] = "Fake", ["Billing:AllowFake"] = allowFake }).Build();
        var register = () => new ServiceCollection().AddPlayBilling(config, development, production: false);
        if (starts) register();
        else Assert.Throws<InvalidOperationException>(register);
    }

    [Theory]
    [InlineData(true, null, true)]
    [InlineData(false, null, false)]
    [InlineData(false, "true", true)]
    [InlineData(true, "false", false)]
    public void TestPurchasesAreAllowedOnlyInDevelopmentUnlessConfigured(bool development, string? setting, bool expected)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Billing:AllowFake"] = "true", ["Billing:AllowTestPurchases"] = setting }).Build();
        var services = new ServiceCollection();
        services.AddPlayBilling(config, development);
        using var provider = services.BuildServiceProvider();
        Assert.Equal(expected, provider.GetRequiredService<BillingOptions>().AllowTestPurchases);
    }

    private sealed class LogSink : ILoggerProvider
    {
        public System.Collections.Concurrent.ConcurrentBag<string> Messages { get; } = [];
        public ILogger CreateLogger(string categoryName) => new Sink(this, categoryName);
        public void Dispose() { }
        private sealed class Sink(LogSink owner, string category) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull
            {
                owner.Messages.Add(category + " " + state);
                return null;
            }
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                owner.Messages.Add(category + " " + formatter(state, exception));
        }
    }

    private sealed class TestBearer : IGoogleAccessTokenSource
    {
        public Task<string> GetAsync(CancellationToken ct) => Task.FromResult("test-bearer");
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public List<string> Requests { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal("test-bearer", request.Headers.Authorization?.Parameter);
            Requests.Add(request.Method + " " + request.RequestUri!.AbsolutePath);
            const string json = """
                {"lineItems":[{"productId":"patika_destekci","expiryTime":"2030-01-01T00:00:00Z",
                "autoRenewingPlan":{"autoRenewEnabled":true},"offerDetails":{"basePlanId":"aylik"}}],
                "subscriptionState":"SUBSCRIPTION_STATE_ACTIVE","acknowledgementState":"ACKNOWLEDGEMENT_STATE_PENDING","testPurchase":{},
                "externalAccountIdentifiers":{"obfuscatedExternalAccountId":"acct-1"}}
                """;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(request.Method == HttpMethod.Get ? json : "", Encoding.UTF8, "application/json"),
            });
        }
    }
}
