using Patika.Contracts.Geo;

namespace Patika.Contracts.Urgent;

/// <summary>Category is <c>Injured|Sick|Trapped|Other</c>; <c>PhotoKey</c> comes from an urgent presign.</summary>
public sealed record CreateUrgentPostRequest(
    CoordinateDto Location,
    string Category,
    string Description,
    string PhotoKey);

/// <summary>State is <c>Handled|Closed</c>; an urgent post never goes back to <c>Open</c>.</summary>
public sealed record UpdateUrgentPostRequest(string State);

public sealed record UrgentPostResponse(
    Guid Id,
    CoordinateDto Location,
    string Category,
    string Description,
    string PhotoKey,
    string State,
    int NotifiedCount,
    DateTimeOffset CreatedAt,
    int? DistanceMeters, string? PhotoUrl = null);

public sealed record UrgentPostListResponse(IReadOnlyList<UrgentPostResponse> Items);

/// <summary>
/// Registers an FCM registration token for the signed-in user (Android first, APNs later).
/// <c>InstallationId</c> is a UUID the app creates once per install and keeps; a token can only move
/// between accounts when the same installation presents it.
/// </summary>
public sealed record RegisterDeviceRequest(string Token, Guid InstallationId, string? Environment);

public sealed record UnregisterDeviceRequest(string Token);

/// <summary>
/// Urgent-help opt-in. <c>HomeArea</c> is a saved approximate area (rounded to 3 decimals, about
/// 110 m), never a live position; it is required when opting in and erased when opting out.
/// </summary>
public sealed record UrgentSettingsRequest(bool OptIn, CoordinateDto? HomeArea, int? RadiusMeters);

public sealed record UrgentSettingsResponse(bool OptIn, CoordinateDto? HomeArea, int RadiusMeters);

public static class UrgentErrorCodes
{
    public const string DailyCapReached = "urgent_daily_cap";
    public const string PhotoNotFound = "urgent_photo_not_found";
    public const string NotFound = "urgent_not_found";
    public const string InvalidTransition = "urgent_invalid_transition";
    public const string DeviceLimit = "device_limit";
    public const string DeviceTokenInUse = "device_token_in_use";
}
