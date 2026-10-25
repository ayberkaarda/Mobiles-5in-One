using FluentValidation;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Auth;

namespace Patika.Api.Features.Auth;

public sealed class TotpCodeRequestValidator : AbstractValidator<TotpCodeRequest>
{
    public TotpCodeRequestValidator() => RuleFor(x => x.Code).NotNull().MaximumLength(128);
}

public sealed class MfaRequestValidator : AbstractValidator<MfaRequest>
{
    public MfaRequestValidator()
    {
        RuleFor(x => x.MfaToken).Must(RefreshTokens.LooksValid);
        RuleFor(x => x.Code).MaximumLength(128);
        RuleFor(x => x.RecoveryCode).MaximumLength(128);
    }
}
