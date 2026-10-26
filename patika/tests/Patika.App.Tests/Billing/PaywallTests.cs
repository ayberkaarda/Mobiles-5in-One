using Patika.App.Services.Billing;
using Patika.App.ViewModels.Billing;
using Patika.Contracts.Subscriptions;
using Xunit;

namespace Patika.App.Tests.Billing;

public sealed class PaywallTests
{
    [Fact]
    public async Task ProductsPurchaseRestoreAndBadgeFollowServerEntitlement()
    {
        var fake = new BillingFake(); var api = new ApiFake(); var vm = new DestekciViewModel(fake, api);
        await vm.LoadAsync();
        Assert.Equal("products", vm.State); Assert.Equal(2, vm.Products.Count);
        Assert.Equal("aylik", vm.SelectedProduct?.BasePlanId); Assert.False(vm.Supporter);
        await vm.PurchaseCommand.ExecuteAsync(null);
        Assert.Equal("success", vm.State); Assert.True(vm.Supporter); Assert.StartsWith("Destekçisin.", vm.EntitlementText); Assert.False(vm.CanPurchase);
        Assert.Equal("acct-1", fake.AccountId);
        api.Response = new(false, null, "Expired");
        await vm.LoadAsync(); Assert.False(vm.Supporter);
        await vm.RestoreCommand.ExecuteAsync(null);
        Assert.Equal("success", vm.State); Assert.True(vm.Supporter); Assert.Equal(2, api.Verifications);
    }
    [Fact]
    public async Task PurchaseFailureLeavesRetryAndRestoreAvailable()
    {
        var fake = new BillingFake { Fail = true }; var vm = new DestekciViewModel(fake, new ApiFake());
        await vm.LoadAsync(); await vm.PurchaseCommand.ExecuteAsync(null);
        Assert.Equal("error", vm.State); Assert.True(vm.HasError); Assert.False(vm.IsBusy);
        fake.Fail = false; await vm.PurchaseCommand.ExecuteAsync(null);
        Assert.Equal("success", vm.State); Assert.False(vm.HasError);
    }
    [Fact]
    public async Task LoadingAndPurchasingAreVisibleWhileAwaitingStore()
    {
        var fake = new BillingFake(); var api = new ApiFake(); var vm = new DestekciViewModel(fake, api);
        fake.ProductsPending = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var loading = vm.LoadAsync(); Assert.True(vm.IsBusy); Assert.Equal("loading", vm.State);
        fake.ProductsPending.SetResult(fake.Products); await loading;
        fake.PurchasePending = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var purchasing = vm.PurchaseCommand.ExecuteAsync(null); Assert.Equal("purchasing", vm.State);
        fake.PurchasePending.SetResult(new("patika_destekci", "aylik", "test")); await purchasing;
        Assert.True(vm.Supporter); Assert.False(vm.IsBusy);
    }
    private sealed class BillingFake : IBillingClient
    {
        public event EventHandler<BillingPurchase>? PurchaseUpdated { add { } remove { } }
        public bool Fail { get; set; }
        public IReadOnlyList<BillingProduct> Products { get; } = [new("patika_destekci", "aylik", "Aylık", "49,99"), new("patika_destekci", "yillik", "Yıllık", "449,99")];
        public TaskCompletionSource<IReadOnlyList<BillingProduct>>? ProductsPending { get; set; }
        public TaskCompletionSource<BillingPurchase>? PurchasePending { get; set; }
        public Task<IReadOnlyList<BillingProduct>> QueryProducts() => ProductsPending?.Task ?? Task.FromResult(Products);
        public string? AccountId { get; private set; }
        public Task<BillingPurchase> LaunchPurchase(BillingProduct product, string accountId)
        {
            AccountId = accountId;
            return Fail
                ? throw new InvalidOperationException("Test ödemesi tamamlanmadı.")
                : PurchasePending?.Task ?? Task.FromResult(new BillingPurchase(product.ProductId, product.BasePlanId, "test"));
        }
        public Task<IReadOnlyList<BillingPurchase>> QueryPurchases() => Task.FromResult<IReadOnlyList<BillingPurchase>>([new("patika_destekci", "aylik", "test")]);
    }
    private sealed class ApiFake : ISubscriptionApi
    {
        public EntitlementResponse Response { get; set; } = new(false, null, null);
        public int Verifications { get; private set; }
        public Task<EntitlementResponse> Entitlement() => Task.FromResult(Response with { BillingAccountId = "acct-1" });
        public Task<EntitlementResponse> Verify(BillingPurchase purchase)
        {
            Verifications++; Response = new(true, DateTimeOffset.UtcNow.AddDays(30), "Active"); return Task.FromResult(Response);
        }
    }
}
