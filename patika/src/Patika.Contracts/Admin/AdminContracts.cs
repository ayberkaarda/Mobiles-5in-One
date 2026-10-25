namespace Patika.Contracts.Admin;

public sealed record StepUpRequest(string Code, string Reason);
public sealed record StepUpResponse(string StepUpToken, int ExpiresIn = 300);
public sealed record AdminDecisionRequest(string TargetType, Guid TargetId, string Decision, string? Reason);
public sealed record AdminRoleRequest(string Role);
public sealed record AdminSuspendRequest(DateTimeOffset? Until, string Reason);
public sealed record AdminAuthor(string Id, int AccountAgeDays, int PriorRejectionCount);
public sealed record AdminQueueItem(Guid Id, string Type, string Content, string State, bool Hidden,
    string? PhotoUrl, DateTimeOffset CreatedAt, AdminAuthor? Author);
public sealed record AdminPage<T>(IReadOnlyList<T> Items, string? NextCursor);
public sealed record AdminUser(Guid Id, string? Email, string Role, DateTimeOffset CreatedAt, bool TotpEnabled,
    int AdoptionCount, int UrgentCount, int RejectionCount);
public sealed record AdminAudit(Guid Id, Guid? ActorId, string Action, string TargetType, Guid? TargetId,
    string? DetailsJson, DateTimeOffset CreatedAt);
public sealed record CarePlaceCsvFields(string Name, string Kind, double Latitude, double Longitude, string Address,
    string? Phone, bool Open24h, string? District, string? Website);
public sealed record CarePlaceCsvRow(int Row, string Status, IReadOnlyList<string> Errors, CarePlaceCsvFields? Fields);
public sealed record CarePlacePreview(string PreviewHash, IReadOnlyList<CarePlaceCsvRow> Rows);
public sealed record CarePlaceCommit(string FileHash, int Inserted, bool AlreadyCommitted);
