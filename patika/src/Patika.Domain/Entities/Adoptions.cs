namespace Patika.Domain.Entities;

public sealed class AdoptionPost : Entity
{
    public string Slug { get; set; } = "";
    public Guid? DistrictId { get; set; }
    public AdoptionClosedReason? ClosedReason { get; set; }
    public DateTimeOffset? AdoptedAt { get; set; }
    public Guid AnimalId { get; set; }
    public required string Description { get; set; }
    public required string Requirements { get; set; }
    public required string District { get; set; }
    public AdoptionPostState State { get; set; }
    public DateTimeOffset ClosesAt { get; set; }
    public Guid CreatedBy { get; set; }
}

public sealed class AdoptionRequest : Entity
{
    public Guid PostId { get; set; }
    public Guid RequesterId { get; set; }
    public required string Message { get; set; }
    public string? Reply { get; set; }
    public AdoptionRequestState State { get; set; }
}
