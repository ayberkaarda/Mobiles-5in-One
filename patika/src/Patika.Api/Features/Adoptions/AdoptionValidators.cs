using FluentValidation;
using Patika.Contracts.Adoptions;

namespace Patika.Api.Features.Adoptions;

public sealed class CreateAdoptionPostValidator : AbstractValidator<CreateAdoptionPost>
{
    public CreateAdoptionPostValidator()
    {
        RuleFor(x => x.Description).Must(x => AdoptionText.Clean(x).Length > 0).MaximumLength(5000);
        RuleFor(x => x.Requirements).Must(x => AdoptionText.Clean(x).Length > 0).MaximumLength(3000);
        RuleFor(x => x.District).Must(x => AdoptionText.Clean(x).Length > 0).MaximumLength(100);
    }
}

public sealed class UpdateAdoptionPostValidator : AbstractValidator<UpdateAdoptionPost>
{
    public UpdateAdoptionPostValidator()
    {
        RuleFor(x => x.Description).Must(x => x is null || AdoptionText.Clean(x).Length > 0).MaximumLength(5000);
        RuleFor(x => x.Requirements).Must(x => x is null || AdoptionText.Clean(x).Length > 0).MaximumLength(3000);
        RuleFor(x => x.District).Must(x => x is null || AdoptionText.Clean(x).Length > 0).MaximumLength(100);
        RuleFor(x => x.State).Must(x => x is null or "Published" or "Rejected" or "Closed");
    }
}

public sealed class CreateAdoptionRequestValidator : AbstractValidator<CreateAdoptionRequest>
{
    public CreateAdoptionRequestValidator() => RuleFor(x => x.Message)
        .Must(x => AdoptionText.Clean(x).Length > 0).MaximumLength(3000);
}

public sealed class ReplyToAdoptionRequestValidator : AbstractValidator<ReplyToAdoptionRequest>
{
    public ReplyToAdoptionRequestValidator() => RuleFor(x => x.Reply)
        .Must(x => AdoptionText.Clean(x).Length > 0).MaximumLength(3000);
}
