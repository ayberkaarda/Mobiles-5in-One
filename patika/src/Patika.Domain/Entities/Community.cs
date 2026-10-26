namespace Patika.Domain.Entities;

public sealed class UrgentPost : Entity
{
    public GeoPoint Location { get; set; }
    public UrgentCategory Category { get; set; }
    public required string Description { get; set; }
    public required string PhotoKey { get; set; }
    public UrgentPostState State { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTimeOffset? HiddenAt { get; set; }
    public string? HiddenReason { get; set; }
    public DateTimeOffset? FanoutAt { get; set; }
    public int NotifiedCount { get; set; }

    /// <summary>Recipients (in fan-out order) already handled when a capped fan-out was deferred.</summary>
    public int FanoutOffset { get; set; }

    /// <summary>Set while the rest of a capped fan-out waits for the next budget window.</summary>
    public DateTimeOffset? FanoutRetryAt { get; set; }
}

public sealed class CarePlace : Entity
{
    public string Slug { get; set; } = "";
    public string? District { get; set; }
    public Guid? DistrictId { get; set; }
    public string? Website { get; set; }
    public required string Name { get; set; }
    public CarePlaceKind Kind { get; set; }
    public GeoPoint Location { get; set; }
    public required string Address { get; set; }
    public string? Phone { get; set; }
    public string? HoursJson { get; set; }
    public bool Open24h { get; set; }
    public bool Verified { get; set; }
    public bool IsSample { get; set; }
}
