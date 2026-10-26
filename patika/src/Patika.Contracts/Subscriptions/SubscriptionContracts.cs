namespace Patika.Contracts.Subscriptions;

public sealed record VerifySubscriptionRequest(string ProductId, string BasePlanId, string PurchaseToken);

/// <param name="BillingAccountId">Set by the app as Play's <c>obfuscatedExternalAccountId</c> when it launches a purchase.</param>
public sealed record EntitlementResponse(bool Supporter, DateTimeOffset? ExpiresAt, string? Status, string? BillingAccountId = null);
public sealed record FakePurchaseRequest(string BasePlanId, string? ObfuscatedAccountId = null);
public sealed record FakePurchaseResponse(string PurchaseToken);
