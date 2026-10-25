using System.Text.Json.Serialization;

namespace Patika.Contracts.Auth;

public sealed record ForgotPasswordRequest(
    [property: JsonPropertyName("email")] string Email);

/// <summary>The six-digit code from the reset email, with the address it was sent to.</summary>
public sealed record ResetPasswordRequest(
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("newPassword")] string NewPassword);

/// <summary>The only response to a well-formed forgot-password request, whether or not the address has an account.</summary>
public sealed record ForgotPasswordAcceptedResponse(
    [property: JsonPropertyName("status")] string Status)
{
    public static ForgotPasswordAcceptedResponse Pending { get; } = new("reset_email_requested");
}

public static class PasswordResetErrorCodes
{
    public const string ResetInvalid = "reset_invalid";
}
