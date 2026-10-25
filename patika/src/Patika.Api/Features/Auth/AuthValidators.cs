using FluentValidation;
using Patika.Api.Security.Tokens;
using Patika.Api.Validation;
using Patika.Contracts.Auth;

namespace Patika.Api.Features.Auth;

public static class PasswordRules
{
    public const int MinLength = 10;

    // Bounded so that hashing cost cannot be inflated by huge inputs.
    public const int MaxLength = 128;
}

public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(r => r.Email).PatikaEmail();
        RuleFor(r => r.Password)
            .NotEmpty()
            .MinimumLength(PasswordRules.MinLength)
            .MaximumLength(PasswordRules.MaxLength);
        RuleFor(r => r.DisplayName).PlainText(2, 60);
    }
}

public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(r => r.Email).NotEmpty().MaximumLength(TextRules.MaxEmailLength);
        RuleFor(r => r.Password).NotEmpty().MaximumLength(PasswordRules.MaxLength);
    }
}

public sealed class GoogleSignInRequestValidator : AbstractValidator<GoogleSignInRequest>
{
    public GoogleSignInRequestValidator()
    {
        RuleFor(r => r.IdToken).NotEmpty().MaximumLength(4096)
            .Must(token => token is null || token.Count(c => c == '.') == 2).WithMessage("ID token is malformed.");
    }
}

public sealed class RefreshRequestValidator : AbstractValidator<RefreshRequest>
{
    public RefreshRequestValidator()
    {
        RuleFor(r => r.RefreshToken).NotEmpty()
            .Must(RefreshTokens.LooksValid).WithMessage("Refresh token is malformed.");
    }
}

public sealed class LogoutRequestValidator : AbstractValidator<LogoutRequest>
{
    public LogoutRequestValidator()
    {
        RuleFor(r => r.RefreshToken).NotEmpty()
            .Must(RefreshTokens.LooksValid).WithMessage("Refresh token is malformed.");
    }
}

public static class EmailNormalizer
{
    public static string Normalize(string email) => email.Trim().Normalize(System.Text.NormalizationForm.FormKC).ToLowerInvariant();
}

public sealed class VerifyEmailRequestValidator : AbstractValidator<VerifyEmailRequest>
{
    public VerifyEmailRequestValidator()
    {
        RuleFor(r => r.Email).NotEmpty().MaximumLength(TextRules.MaxEmailLength);
        RuleFor(r => r.Code).NotEmpty()
            .Must(EmailCodeHasher.LooksValid).WithMessage("Verification code must be six digits.");
    }
}

public sealed class ResendVerificationRequestValidator : AbstractValidator<ResendVerificationRequest>
{
    public ResendVerificationRequestValidator()
    {
        RuleFor(r => r.Email).PatikaEmail();
    }
}

public sealed class LinkExternalLoginRequestValidator : AbstractValidator<LinkExternalLoginRequest>
{
    public LinkExternalLoginRequestValidator()
    {
        RuleFor(r => r.IdToken).NotEmpty().MaximumLength(4096)
            .Must(token => token is null || token.Count(c => c == '.') == 2).WithMessage("ID token is malformed.");
    }
}
