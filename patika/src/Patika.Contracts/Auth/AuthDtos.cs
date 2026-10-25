using System.Text.Json.Serialization;

namespace Patika.Contracts.Auth;

public sealed record RegisterRequest(
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("password")] string Password,
    [property: JsonPropertyName("displayName")] string DisplayName);

public sealed record LoginRequest(
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("password")] string Password);

public sealed record GoogleSignInRequest(
    [property: JsonPropertyName("idToken")] string IdToken);

public sealed record RefreshRequest(
    [property: JsonPropertyName("refreshToken")] string RefreshToken);

public sealed record LogoutRequest(
    [property: JsonPropertyName("refreshToken")] string RefreshToken);

public sealed record TokenResponse(
    [property: JsonPropertyName("accessToken")] string AccessToken,
    [property: JsonPropertyName("tokenType")] string TokenType,
    [property: JsonPropertyName("expiresIn")] int ExpiresIn,
    [property: JsonPropertyName("refreshToken")] string RefreshToken,
    [property: JsonPropertyName("refreshExpiresIn")] int RefreshExpiresIn);

public sealed record MeResponse(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("email")] string? Email,
    [property: JsonPropertyName("displayName")] string DisplayName,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("emailVerified")] bool EmailVerified);


public sealed record VerifyEmailRequest(
    [property: JsonPropertyName("token")] string Token);

public sealed record LinkExternalLoginRequest(
    [property: JsonPropertyName("idToken")] string IdToken);

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
}
