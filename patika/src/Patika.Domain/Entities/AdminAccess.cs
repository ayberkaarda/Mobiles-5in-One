namespace Patika.Domain.Entities;

public sealed class TotpRecoveryCode : Entity
{
    public Guid UserId { get; set; }
    public required byte[] CodeHash { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
}

public sealed class AdminAccessToken : Entity
{
    public Guid UserId { get; set; }
    public Guid SessionId { get; set; }
    public int SessionVersion { get; set; }
    public required string Purpose { get; set; }
    public required byte[] TokenHash { get; set; }
    public string? Reason { get; set; }
    /// <summary>The first factor of an MFA challenge; it joins <c>mfa</c> in the issued token's <c>amr</c>.</summary>
    public string? AuthMethod { get; set; }
    public DateTimeOffset AuthTime { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
}

public sealed class CarePlaceImport : Entity
{
    public required string FileHash { get; set; }
    public int RowCount { get; set; }
}
