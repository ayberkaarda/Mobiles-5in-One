namespace Patika.Domain.Entities;

public sealed class Report : Entity
{
    public required string TargetType { get; set; }
    public Guid TargetId { get; set; }
    public Guid ReporterId { get; set; }
    public required string Reason { get; set; }
    public ReportState State { get; set; }
}

public sealed class AuditLog : Entity
{
    public Guid? ActorId { get; set; }
    public required string Action { get; set; }
    public required string TargetType { get; set; }
    public Guid? TargetId { get; set; }
    public string? DetailsJson { get; set; }
}

public sealed class DeletionRequest : Entity
{
    public Guid UserId { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset ExecuteAfter { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}
