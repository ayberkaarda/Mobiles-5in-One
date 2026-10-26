namespace Patika.Domain.Entities;

public sealed class Subscription : Entity
{
    public Guid? UserId { get; set; }
    public required string PurchaseTokenHash { get; set; }
    public string ProtectedPurchaseToken { get; set; } = "";
    public string BasePlanId { get; set; } = "aylik";
    public bool AutoRenewing { get; set; }
    public bool Acknowledged { get; set; }
    public string? LinkedPurchaseTokenHash { get; set; }
    public DateTimeOffset LastEventAt { get; set; }
    public required string ProductId { get; set; }
    public SubscriptionStatus Status { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public BillingEnvironment Environment { get; set; }
}

public sealed class PlayNotification : Entity
{
    public required string MessageId { get; set; }
    public required string Type { get; set; }
    public required string PayloadHash { get; set; }
    public string? PurchaseTokenHash { get; set; }
    public DateTimeOffset EventAt { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
    /// <summary>Failed processing tries; the row is set aside after the limit and the daily reconcile covers it.</summary>
    public int Attempts { get; set; }
}
