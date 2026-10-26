using System.Text.Json.Serialization;

namespace Patika.Contracts.Auth;

public sealed record RegisterRequest(
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("password"), Verbatim] string Password,
    [property: JsonPropertyName("displayName")] string DisplayName);

public sealed record LoginRequest(
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("password"), Verbatim] string Password);

public sealed record GoogleSignInRequest(
    [property: JsonPropertyName("idToken"), Verbatim] string IdToken);

public sealed record RefreshRequest(
    [property: JsonPropertyName("refreshToken"), Verbatim] string RefreshToken);

public sealed record LogoutRequest(
    [property: JsonPropertyName("refreshToken"), Verbatim] string RefreshToken);

public sealed record TokenResponse(
    [property: JsonPropertyName("accessToken")] string AccessToken,
    [property: JsonPropertyName("tokenType")] string TokenType,
    [property: JsonPropertyName("expiresIn")] int ExpiresIn,
    [property: JsonPropertyName("refreshToken")] string RefreshToken,
    [property: JsonPropertyName("refreshExpiresIn")] int RefreshExpiresIn);

/// <summary>
/// The signed-in account with its contribution statistics: <c>FeedingCount</c> counts the user's
/// feedings, <c>Badges</c> lists codes from <see cref="MeBadges"/> in that order, <c>JoinedAt</c> is
/// when the account was created.
/// </summary>
public sealed record MeResponse(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("email")] string? Email,
    [property: JsonPropertyName("displayName")] string DisplayName,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("emailVerified")] bool EmailVerified,
    [property: JsonPropertyName("feedingCount")] int FeedingCount,
    [property: JsonPropertyName("badges")] IReadOnlyList<string> Badges,
    [property: JsonPropertyName("joinedAt")] DateTimeOffset JoinedAt);

/// <summary>Badge codes on <see cref="MeResponse.Badges"/>, derived from counts.</summary>
public static class MeBadges
{
    /// <summary>At least one feeding.</summary>
    public const string FirstFeeding = "first_feeding";

    public const string Feedings10 = "feedings_10";

    public const string Feedings50 = "feedings_50";

    public const string Feedings100 = "feedings_100";

    /// <summary>At least one sighting.</summary>
    public const string FirstSighting = "first_sighting";

    /// <summary>An adoption post created by the user whose animal is now adopted.</summary>
    public const string FirstAdoptionHelped = "first_adoption_helped";
}

/// <summary>The six-digit code from the verification email, with the address it was sent to.</summary>
public sealed record VerifyEmailRequest(
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("code")] string Code);

/// <summary>
/// Asks for a new verification code. Always 202 with the same body as registration; when the
/// address has an unverified account, a new code is sent and the previous one stops working.
/// </summary>
public sealed record ResendVerificationRequest(
    [property: JsonPropertyName("email")] string Email);

public sealed record LinkExternalLoginRequest(
    [property: JsonPropertyName("idToken"), Verbatim] string IdToken);

/// <summary>
/// The only response to a well-formed registration, whether or not the address already has an
/// account: the next step always arrives by email.
/// </summary>
public sealed record RegisterAcceptedResponse(
    [property: JsonPropertyName("status")] string Status)
{
    public static RegisterAcceptedResponse Pending { get; } = new("verification_pending");
}

/// <summary>Machine-readable error codes returned in the <c>code</c> member of problem details.</summary>
public static class AuthErrorCodes
{
    public const string ValidationFailed = "validation_failed";
    public const string InvalidCredentials = "invalid_credentials";
    public const string PasswordBreached = "password_breached";
    public const string VerificationInvalid = "verification_invalid";
    public const string ExternalTokenInvalid = "external_token_invalid";
    public const string LinkRequired = "link_required";
    public const string ExternalLoginInUse = "external_login_in_use";
    public const string ReauthenticationRequired = "reauthentication_required";
    public const string RefreshInvalid = "refresh_invalid";
    public const string RefreshReused = "refresh_reused";
    public const string RateLimited = "rate_limited";

    /// <summary>503 with <c>Retry-After</c>: the email budget is used up, so no code or notice can be sent now.</summary>
    public const string EmailUnavailable = "email_unavailable";
}
