namespace Patika.Domain.Entities;

public sealed class UrgentPost : Entity
{
    public GeoPoint Location { get; set; }
    public UrgentCategory Category { get; set; }
    public required string Description { get; set; }
    public required string PhotoKey { get; set; }
    public UrgentPostState State { get; set; }
    public Guid CreatedBy { get; set; }
    public int NotifiedCount { get; set; }
}

public sealed class CarePlace : Entity
{
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
