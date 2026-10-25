namespace Patika.Domain.Entities;

public sealed class Upload : Entity
{
    public Guid UserId { get; set; }
    public required string Kind { get; set; }
    public required string Key { get; set; }
    public required string ContentType { get; set; }
    public long ContentLength { get; set; }
    public required string State { get; set; }
    public string? FailureCode { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
}
