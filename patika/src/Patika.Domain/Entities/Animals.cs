namespace Patika.Domain.Entities;

public sealed class Animal : Entity
{
    public Guid? StationId { get; set; }
    public string? District { get; set; }
    public GeoPoint Location { get; set; }
    public Species Species { get; set; }
    public string? Name { get; set; }
    public AnimalSex Sex { get; set; }
    public bool Sterilized { get; set; }
    public bool Vaccinated { get; set; }
    public bool EarTagged { get; set; }
    public AnimalStatus Status { get; set; }
    public Guid CreatedBy { get; set; }
}

public sealed class AnimalPhoto : Entity
{
    public Guid AnimalId { get; set; }
    public required string Key { get; set; }
    public Guid CreatedBy { get; set; }
    public ModerationState ModerationState { get; set; }
}

public sealed class Sighting : Entity
{
    public Guid AnimalId { get; set; }
    public Guid? UserId { get; set; }
    public DateTimeOffset At { get; set; }
    public string? Note { get; set; }
}

public sealed class Follow : Entity
{
    public Guid UserId { get; set; }
    public Guid AnimalId { get; set; }
}
