namespace Patika.Contracts.Subscriptions;

public sealed record VerifySubscriptionRequest(string ProductId, string BasePlanId, string PurchaseToken);
public sealed record EntitlementResponse(bool Supporter, DateTimeOffset? ExpiresAt, string? Status);
public sealed record FakePurchaseRequest(string BasePlanId);
public sealed record FakePurchaseResponse(string PurchaseToken);
