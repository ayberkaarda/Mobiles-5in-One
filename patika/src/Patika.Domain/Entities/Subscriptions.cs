namespace Patika.Domain.Entities;

public sealed class Subscription : Entity
{
    public Guid? UserId { get; set; }
    public required string OriginalTransactionIdHash { get; set; }
    public required string ProductId { get; set; }
    public SubscriptionStatus Status { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public StoreEnvironment Environment { get; set; }
    public Guid? LastNotificationUuid { get; set; }
}

public sealed class AppStoreNotification : Entity
{
    public Guid NotificationUuid { get; set; }
    public required string Type { get; set; }
    public string? Subtype { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
}
