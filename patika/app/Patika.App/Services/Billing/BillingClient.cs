using Patika.App.Core.Api;
using Patika.Contracts.Subscriptions;

namespace Patika.App.Services.Billing;

public sealed record BillingProduct(string ProductId, string BasePlanId, string Title, string Price);
public sealed record BillingPurchase(string ProductId, string BasePlanId, string PurchaseToken);
public interface IBillingClient
{
    event EventHandler<BillingPurchase>? PurchaseUpdated;
    Task<IReadOnlyList<BillingProduct>> QueryProducts();
    Task<BillingPurchase> LaunchPurchase(BillingProduct product);
    Task<IReadOnlyList<BillingPurchase>> QueryPurchases();
}
public interface IBillingPurchaseStore
{
    Task<IReadOnlyList<BillingPurchase>> ReadAsync(string userId);
    Task WriteAsync(string userId, IReadOnlyList<BillingPurchase> purchases);
}
public interface ISubscriptionApi
{
    Task<EntitlementResponse> Entitlement();
    Task<EntitlementResponse> Verify(BillingPurchase purchase);
}
public sealed class SubscriptionApi(PatikaApiClient api) : ISubscriptionApi
{
    public async Task<EntitlementResponse> Entitlement() =>
        await api.SendAsync<EntitlementResponse>(HttpMethod.Get, "me/entitlement", null, AuthMode.Required)
        ?? throw new InvalidOperationException("Boş yanıt.");
    public async Task<EntitlementResponse> Verify(BillingPurchase purchase) =>
        await api.SendAsync<EntitlementResponse>(HttpMethod.Post, "subscriptions/verify",
            new VerifySubscriptionRequest(purchase.ProductId, purchase.BasePlanId, purchase.PurchaseToken), AuthMode.Required)
        ?? throw new InvalidOperationException("Boş yanıt.");
}

public sealed class FakeBillingClient(PatikaApiClient api, IBillingPurchaseStore store) : IBillingClient
{
    public event EventHandler<BillingPurchase>? PurchaseUpdated;
    public Task<IReadOnlyList<BillingProduct>> QueryProducts() => Task.FromResult<IReadOnlyList<BillingProduct>>([
        new("patika_destekci", "aylik", "Aylık", "₺49,99 / ay"),
        new("patika_destekci", "yillik", "Yıllık", "₺449,99 / yıl")]);
    public async Task<BillingPurchase> LaunchPurchase(BillingProduct product)
    {
        var session = api.Tokens.Bind() ?? throw new InvalidOperationException("Önce giriş yap.");
        var userId = session.UserId;
        // The typed client resolves paths relative to /v1/.
        var response = await api.SendAsync<FakePurchaseResponse>(HttpMethod.Post, "../dev/billing/purchases",
            new FakePurchaseRequest(product.BasePlanId), AuthMode.Required, session: session) ?? throw new InvalidOperationException("Test ödemesi alınamadı.");
        var purchase = new BillingPurchase(product.ProductId, product.BasePlanId, response.PurchaseToken);
        var previous = await store.ReadAsync(userId);
        await store.WriteAsync(userId, [.. previous, purchase]);
        PurchaseUpdated?.Invoke(this, purchase);
        return purchase;
    }
    public Task<IReadOnlyList<BillingPurchase>> QueryPurchases() =>
        store.ReadAsync(api.Tokens.UserId ?? throw new InvalidOperationException("Önce giriş yap."));
}

/// <summary>A native Play Billing Library binding is intentionally absent from this portfolio.</summary>
public sealed class PlayBillingClient : IBillingClient
{
    public event EventHandler<BillingPurchase>? PurchaseUpdated { add { } remove { } }
    public Task<IReadOnlyList<BillingProduct>> QueryProducts() => throw new NotSupportedException();
    public Task<BillingPurchase> LaunchPurchase(BillingProduct product) => throw new NotSupportedException();
    public Task<IReadOnlyList<BillingPurchase>> QueryPurchases() => throw new NotSupportedException();
}
