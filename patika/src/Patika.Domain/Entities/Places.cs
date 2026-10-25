namespace Patika.Domain.Entities;

public sealed class Province : Entity
{
    public required string Name { get; set; }
    public required string Slug { get; set; }
}

public sealed class District : Entity
{
    public Guid ProvinceId { get; set; }
    public required string Name { get; set; }
    public required string Slug { get; set; }
}

public sealed class ModerationDecision : Entity
{
    public required string TargetType { get; set; }
    public Guid TargetId { get; set; }
    public ModerationDecisionKind Decision { get; set; }
    public string? Reason { get; set; }
    public Guid ReviewerId { get; set; }
    public DateTimeOffset DecidedAt { get; set; }
}
