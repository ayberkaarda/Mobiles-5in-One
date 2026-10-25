namespace Patika.Contracts.Adoptions;

public sealed record CreateAdoptionPost(string Description, string Requirements, string District);
public sealed record UpdateAdoptionPost(string? Description, string? Requirements, string? District, string? State);
public sealed record CreateAdoptionRequest(string Message);
public sealed record ReplyToAdoptionRequest(string Reply);
public sealed record AdoptionPostResponse(Guid Id, Guid AnimalId, string Description, string Requirements,
    string District, string State, DateTimeOffset ClosesAt);
public sealed record AdoptionRequestResponse(Guid Id, Guid PostId, string Message, string? Reply, string State);
