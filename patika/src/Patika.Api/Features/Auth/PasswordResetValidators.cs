using FluentValidation;
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
        RuleFor(r => r.Email).NotEmpty().MaximumLength(TextRules.MaxEmailLength);
        RuleFor(r => r.Code).NotEmpty()
            .Must(EmailCodeHasher.LooksValid).WithMessage("Reset code must be six digits.");
        RuleFor(r => r.NewPassword)
            .NotEmpty()
            .MinimumLength(PasswordRules.MinLength)
            .MaximumLength(PasswordRules.MaxLength);
    }
}
