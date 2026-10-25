namespace Patika.Domain.Entities;

public sealed class User : Entity
{
    public string? Email { get; set; }
    public DateTimeOffset? EmailVerifiedAt { get; set; }
    public string? PasswordHash { get; set; }
    // Access token claim sv; increment on password reset, deactivation and deletion cancellation.
    public int SessionVersion { get; set; }
    public string? AppleSub { get; set; }
    public required string DisplayName { get; set; }
    public string? District { get; set; }
    public UserRole Role { get; set; }
    public GeoPoint? UrgentHome { get; set; }
    public bool UrgentOptIn { get; set; }
    public int UrgentRadiusM { get; set; } = 2000;
    public string? TotpSecretEnc { get; set; }
    public DateTimeOffset? DeactivatedAt { get; set; }
}
