using FluentValidation;
using Patika.Api.Security.Tokens;
using Patika.Api.Validation;
using Patika.Contracts.Auth;

namespace Patika.Api.Features.Auth;

public sealed class ForgotPasswordRequestValidator : AbstractValidator<ForgotPasswordRequest>
{
    public ForgotPasswordRequestValidator()
    {
        RuleFor(r => r.Email).PatikaEmail();
    }
}

public sealed class ResetPasswordRequestValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordRequestValidator()
    {
        RuleFor(r => r.Token).NotEmpty()
            .Must(RefreshTokens.LooksValid).WithMessage("Reset code is malformed.");
        RuleFor(r => r.NewPassword)
            .NotEmpty()
            .MinimumLength(PasswordRules.MinLength)
            .MaximumLength(PasswordRules.MaxLength);
    }
}
