namespace Patika.Domain.Entities;

public sealed class Station : Entity
{
    public string? Name { get; set; }
    public GeoPoint Location { get; set; }
    public StationKind Kind { get; set; }
    public Species Species { get; set; }
    public required string PhotoKey { get; set; }
    public Guid CreatedBy { get; set; }
    public StationStatus Status { get; set; }
    public DateTimeOffset? LastFedAt { get; set; }
    public long FeedingsCount { get; set; }
}

public sealed class Feeding : Entity
{
    public Guid StationId { get; set; }
    public Guid? UserId { get; set; }
    public DateTimeOffset At { get; set; }
    public string? PhotoKey { get; set; }
    public string? Note { get; set; }
}
