using FluentValidation;
using Patika.Api.Features.Stations;
using Patika.Api.Idempotency;
using Patika.Api.Validation;
using Patika.Contracts.Community;
using Patika.Domain.Entities;

namespace Patika.Api.Features.Animals;

public sealed class AnimalRequestValidator : AbstractValidator<AnimalRequest>
{
    public AnimalRequestValidator()
    {
        RuleFor(x => x.Location).NotNull().SetValidator(new CoordinateValidator());
        RuleFor(x => x.Species).Must(CommunityValidation.EnumName<Species>);
        RuleFor(x => x.Sex).Must(CommunityValidation.EnumName<AnimalSex>);
        RuleFor(x => x.Status).Must(CommunityValidation.EnumName<AnimalStatus>);
        RuleFor(x => x.District).MaximumLength(60).Must(TextRules.HasNoControlCharacters);
        RuleFor(x => x.Name).MaximumLength(100).Must(TextRules.HasNoControlCharacters);
        RuleFor(x => x.StationId).NotEqual(Guid.Empty).When(x => x.StationId.HasValue);
    }
}
public sealed class AnimalUpdateRequestValidator : AbstractValidator<AnimalUpdateRequest>
{
    public AnimalUpdateRequestValidator()
    {
        RuleFor(x => x.Location!).SetValidator(new CoordinateValidator()).When(x => x.Location is not null);
        RuleFor(x => x.Species).Must(x => x is null || CommunityValidation.EnumName<Species>(x));
        RuleFor(x => x.Sex).Must(x => x is null || CommunityValidation.EnumName<AnimalSex>(x));
        RuleFor(x => x.Status).Must(x => x is null || CommunityValidation.EnumName<AnimalStatus>(x));
        RuleFor(x => x.District).MaximumLength(60).Must(TextRules.HasNoControlCharacters);
        RuleFor(x => x.Name).MaximumLength(100).Must(TextRules.HasNoControlCharacters);
        RuleFor(x => x.StationId).NotEqual(Guid.Empty).When(x => x.StationId.HasValue);
    }
}
public sealed class AnimalPhotoRequestValidator : AbstractValidator<AnimalPhotoRequest>
{
    public AnimalPhotoRequestValidator() => RuleFor(x => x.Key).Must(CommunityValidation.Key);
}
public sealed class SightingRequestValidator : AbstractValidator<SightingRequest>
{
    public SightingRequestValidator(TimeProvider? clock = null)
    {
        RuleFor(x => x.Note).MaximumLength(2000).Must(TextRules.HasNoControlCharacters);
        RuleFor(r => r.ClientCreatedAt).ClientCreatedAt(clock ?? TimeProvider.System);
    }
}
