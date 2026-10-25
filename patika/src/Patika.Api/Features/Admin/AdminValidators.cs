using FluentValidation;
using Patika.Api.Features.Auth;
using Patika.Contracts.Admin;

namespace Patika.Api.Features.Admin;

public sealed class StepUpRequestValidator : AbstractValidator<StepUpRequest>
{
    public StepUpRequestValidator()
    {
        RuleFor(x => x.Code).NotNull().MaximumLength(128);
        RuleFor(x => x.Reason).Must(x => TotpService.ReasonValid(x, 300));
    }
}

public sealed class AdminDecisionRequestValidator : AbstractValidator<AdminDecisionRequest>
{
    public AdminDecisionRequestValidator()
    {
        RuleFor(x => x.TargetType).NotEmpty().MaximumLength(50);
        RuleFor(x => x.Decision).NotEmpty().MaximumLength(20);
        RuleFor(x => x.TargetId).NotEmpty();
        RuleFor(x => x.Reason).MaximumLength(500);
    }
}

public sealed class AdminRoleRequestValidator : AbstractValidator<AdminRoleRequest>
{
    public AdminRoleRequestValidator() => RuleFor(x => x.Role).NotEmpty().MaximumLength(20);
}

public sealed class AdminSuspendRequestValidator : AbstractValidator<AdminSuspendRequest>
{
    public AdminSuspendRequestValidator() => RuleFor(x => x.Reason).Must(x => TotpService.ReasonValid(x, 500));
}
