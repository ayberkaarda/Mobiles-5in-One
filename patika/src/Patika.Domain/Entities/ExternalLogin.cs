namespace Patika.Domain.Entities;

public sealed class ExternalLogin : Entity
{
    public required string Provider { get; set; }
    public required string Subject { get; set; }
    public Guid UserId { get; set; }
}
