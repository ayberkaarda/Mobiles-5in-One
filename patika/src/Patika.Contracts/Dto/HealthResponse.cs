namespace Patika.Contracts.Dto;

public sealed record HealthResponse(string Status);

/// <summary>
/// Answer of <c>GET /health/bff</c>: whether this request's <c>X-Patika-Client-Ip</c> claim was accepted (right peer,
/// right key). The Web console calls it at startup and from its own health check; it carries no secret.
/// </summary>
public sealed record BffCheckResponse(bool BffClaimAccepted);
