using System.Net;
using Patika.App.Core.Api;
using Patika.App.Services.Billing;
using Patika.App.ViewModels.Billing;
using Patika.Contracts.Subscriptions;
using Xunit;

namespace Patika.App.Tests.Billing;

public sealed class FakeBillingFlowTests
{
    [Fact]
    public async Task PurchaseSeedsRootDevRouteThenVerifiesAndRestoresThroughVersionedApi()
    {
        const string user = "f27a20a5-79d2-4cca-a624-97d84fb8bb95";
        var granted = false;
        var handler = new FakeHandler(request =>
        {
            Assert.NotNull(request.Bearer);
            if (request.Path == "/dev/billing/purchases")
            {
                // The server-issued account id travels with the purchase, as Play keeps obfuscatedExternalAccountId.
                Assert.Contains("acct-1", request.Body);
                return Http.Done(Http.Json(HttpStatusCode.OK, new FakePurchaseResponse("test-purchase")));
            }
            if (request.Path == "/v1/subscriptions/verify")
            {
                Assert.Contains("test-purchase", request.Body);
                granted = true;
            }
            else Assert.Equal("/v1/me/entitlement", request.Path);
            return Http.Done(Http.Json(HttpStatusCode.OK, new EntitlementResponse(granted, null, granted ? "Active" : null, "acct-1")));
        });
        using var http = new HttpClient(handler);
        var tokens = new TokenManager(new MemoryTokenStore(), TimeProvider.System);
        await tokens.AcceptAsync(Http.Tokens(user, "billing"));
        var api = new PatikaApiClient(http, tokens, new ApiOptions { BaseAddress = new Uri("https://local.test/") });
        var purchases = new MemoryPurchases();
        var billing = new FakeBillingClient(api, purchases);
        var events = 0;
        billing.PurchaseUpdated += (_, _) => events++;
        var vm = new DestekciViewModel(billing, new SubscriptionApi(api));
        await vm.LoadAsync();
        Assert.False(vm.Supporter);
        await vm.PurchaseCommand.ExecuteAsync(null);
        Assert.True(vm.Supporter);
        Assert.Equal(1, events);
        await vm.RestoreCommand.ExecuteAsync(null);
        Assert.Equal("success", vm.State);
        Assert.Equal(1, handler.Count("/dev/billing/purchases"));
        Assert.Equal(2, handler.Count("/v1/subscriptions/verify"));
        Assert.Single(await purchases.ReadAsync(user));
        Assert.Empty(await purchases.ReadAsync("other-account"));
    }

    private sealed class MemoryPurchases : IBillingPurchaseStore
    {
        private readonly Dictionary<string, IReadOnlyList<BillingPurchase>> rows = [];
        public Task<IReadOnlyList<BillingPurchase>> ReadAsync(string userId) => Task.FromResult(rows.GetValueOrDefault(userId) ?? []);
        public Task WriteAsync(string userId, IReadOnlyList<BillingPurchase> purchases)
        {
            rows[userId] = purchases;
            return Task.CompletedTask;
        }
    }
}
