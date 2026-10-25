namespace Patika.Domain.Entities;

public sealed class RefreshToken : Entity
{
    public Guid UserId { get; set; }
    public Guid FamilyId { get; set; }
    public required byte[] TokenHash { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public Guid? ReplacedById { get; set; }
}

public sealed class EmailToken : Entity
{
    public Guid UserId { get; set; }
    public required byte[] TokenHash { get; set; }
    public required string Purpose { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
}

public sealed class DeviceToken : Entity
{
    public Guid UserId { get; set; }
    public Guid InstallationId { get; set; }
    public required string Token { get; set; }
    public StoreEnvironment Environment { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
}
