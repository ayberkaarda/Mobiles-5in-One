using Patika.App.Core.Api;
using Patika.App.Services.Billing;
using Patika.App.ViewModels.Billing;
using Patika.Contracts.Subscriptions;
using Xunit;

namespace Patika.App.Tests.Billing;

public sealed class SupporterTextTests
{
    private static readonly DateTimeOffset Expiry = new(2026, 11, 25, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("Active", "Destekçisin.")]
    [InlineData("InGracePeriod", "Ödeme alınamadı")]
    [InlineData("Canceled", "Abonelik iptal edildi.")]
    [InlineData("OnHold", "askıda")]
    [InlineData("Paused", "duraklatıldı")]
    [InlineData("Revoked", "geri alındı")]
    [InlineData("Expired", "sona erdi")]
    public void EveryServerStatusHasTurkishText(string status, string expected)
    {
        var text = SupporterText.Describe(new EntitlementResponse(status is "Active" or "InGracePeriod" or "Canceled", Expiry, status));
        Assert.Contains(expected, text);
        Assert.DoesNotContain(status, text);
    }

    [Fact]
    public void CanceledKeepsAccessUntilTheDateInTurkish() =>
        Assert.Contains("25 Kasım 2026", SupporterText.Describe(new EntitlementResponse(true, Expiry, "Canceled")));

    [Fact]
    public void NoSubscriptionSaysSo() =>
        Assert.Equal("Henüz Destekçi aboneliğin yok.", SupporterText.Describe(new EntitlementResponse(false, null, null)));

    [Fact]
    public async Task ForeignPurchaseShowsActionableMessage()
    {
        var vm = new DestekciViewModel(new Store(), new Api { Fail = new ApiException(ApiErrorKind.Client, "x", 409, "purchase_owned_elsewhere") });
        await vm.LoadAsync();
        await vm.PurchaseCommand.ExecuteAsync(null);
        Assert.Equal("error", vm.State);
        Assert.Contains("başka bir Patika hesabına bağlı", vm.ErrorMessage);
    }

    [Theory]
    [InlineData("purchase_not_found", "Google Play")]
    [InlineData("test_purchase_not_allowed", "Test ödemeleri")]
    public void StoreFailuresHaveTheirOwnText(string code, string expected) =>
        Assert.Contains(expected, SupporterText.Failure(code));

    [Fact]
    public async Task RestoreContinuesPastARejectedPurchase()
    {
        var api = new Api { RejectToken = "eski" };
        var vm = new DestekciViewModel(new Store { Purchases = [new("patika_destekci", "aylik", "eski"), new("patika_destekci", "yillik", "yeni")] }, api);
        await vm.LoadAsync();
        await vm.RestoreCommand.ExecuteAsync(null);
        Assert.Equal("success", vm.State);
        Assert.True(vm.Supporter);
        Assert.Equal(["eski", "yeni"], api.Verified);
        Assert.Equal("Satın alımların geri yüklendi.", vm.Notice);
    }

    [Fact]
    public async Task RestoreWithNothingStoredSaysSoWithoutCallingTheServer()
    {
        var api = new Api();
        var vm = new DestekciViewModel(new Store(), api);
        await vm.LoadAsync();
        await vm.RestoreCommand.ExecuteAsync(null);
        Assert.Empty(api.Verified);
        Assert.Equal("Bu cihazda geri yüklenecek satın alım yok.", vm.Notice);
    }

    [Fact]
    public async Task MonthlyIsSelectedFirstAndSelectionIsExclusive()
    {
        var vm = new DestekciViewModel(new Store(), new Api());
        await vm.LoadAsync();
        Assert.Equal(["Aylık", "Yıllık"], vm.Plans.Select(p => p.Period));
        Assert.True(vm.Plans[0].IsSelected);
        vm.SelectPlanCommand.Execute(vm.Plans[1]);
        Assert.Equal("yillik", vm.SelectedProduct?.BasePlanId);
        Assert.Equal([false, true], vm.Plans.Select(p => p.IsSelected));
    }

    private sealed class Store : IBillingClient
    {
        public IReadOnlyList<BillingPurchase> Purchases { get; init; } = [];
        public event EventHandler<BillingPurchase>? PurchaseUpdated { add { } remove { } }
        public Task<IReadOnlyList<BillingProduct>> QueryProducts() => Task.FromResult<IReadOnlyList<BillingProduct>>(
            [new("patika_destekci", "aylik", "Aylık", "₺49,99 / ay"), new("patika_destekci", "yillik", "Yıllık", "₺449,99 / yıl")]);
        public Task<BillingPurchase> LaunchPurchase(BillingProduct product, string accountId) => Task.FromResult(new BillingPurchase(product.ProductId, product.BasePlanId, "test"));
        public Task<IReadOnlyList<BillingPurchase>> QueryPurchases() => Task.FromResult(Purchases);
    }

    private sealed class Api : ISubscriptionApi
    {
        private EntitlementResponse current = new(false, null, null);
        public ApiException? Fail { get; init; }
        public string? RejectToken { get; init; }
        public List<string> Verified { get; } = [];
        public Task<EntitlementResponse> Entitlement() => Task.FromResult(current with { BillingAccountId = "acct-1" });
        public Task<EntitlementResponse> Verify(BillingPurchase purchase)
        {
            Verified.Add(purchase.PurchaseToken);
            if (Fail is not null) throw Fail;
            if (purchase.PurchaseToken == RejectToken) throw new ApiException(ApiErrorKind.Client, "x", 400, "purchase_superseded");
            current = new(true, DateTimeOffset.UtcNow.AddDays(30), "Active");
            return Task.FromResult(current);
        }
    }
}
