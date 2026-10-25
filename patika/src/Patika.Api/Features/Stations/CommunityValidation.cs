using System.Globalization;
using FluentValidation;
using Patika.Api.Validation;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Patika.Domain.Entities;

namespace Patika.Api.Features.Stations;

public static class CommunityValidation
{
    public static bool EnumName<T>(string? value) where T : struct, Enum =>
        value is not null && Enum.GetNames<T>().Contains(value, StringComparer.Ordinal);

    public static BoundingBoxQuery? ParseBox(string? value)
    {
        var parts = value?.Split(',');
        if (parts?.Length != 4) return null;
        var numbers = new double[4];
        for (var i = 0; i < 4; i++)
        {
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out numbers[i])) return null;
        }
        return new BoundingBoxQuery(numbers[1], numbers[0], numbers[3], numbers[2]);
    }

    public static bool Key(string? key) => key is { Length: > 0 and <= 512 }
        && TextRules.HasNoControlCharacters(key) && !key.Contains("..", StringComparison.Ordinal)
        && !key.Contains(':') && !key.StartsWith('/') && !key.Contains('\\');
}

public sealed class MapQueryValidator : AbstractValidator<MapQuery>
{
    public MapQueryValidator()
    {
        RuleFor(x => x.Bbox).Must(value => CommunityValidation.ParseBox(value) is { } box
            && new BoundingBoxValidator().Validate(box).IsValid);
        RuleFor(x => x.Zoom).InclusiveBetween(0, 22);
        RuleFor(x => x.Page).InclusiveBetween(1, 100000);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 500);
        RuleFor(x => x.Kind).Must(x => x is null || CommunityValidation.EnumName<StationKind>(x));
        RuleFor(x => x.Species).Must(x => x is null || CommunityValidation.EnumName<Species>(x));
    }
}
public sealed class PageQueryValidator : AbstractValidator<PageQuery>
{
    public PageQueryValidator()
    {
        RuleFor(x => x.Page).InclusiveBetween(1, 100000);
        RuleFor(x => x.PageSize).InclusiveBetween(1, 500);
    }
}
public sealed class StationRequestValidator : AbstractValidator<StationRequest>
{
    public StationRequestValidator()
    {
        RuleFor(x => x.Location).NotNull().SetValidator(new CoordinateValidator());
        RuleFor(x => x.Kind).Must(CommunityValidation.EnumName<StationKind>);
        RuleFor(x => x.Species).Must(CommunityValidation.EnumName<Species>);
        RuleFor(x => x.PhotoKey).Must(CommunityValidation.Key);
        RuleFor(x => x.Name).MaximumLength(200).Must(TextRules.HasNoControlCharacters);
    }
}
public sealed class StationUpdateRequestValidator : AbstractValidator<StationUpdateRequest>
{
    public StationUpdateRequestValidator()
    {
        RuleFor(x => x.Location!).SetValidator(new CoordinateValidator()).When(x => x.Location is not null);
        RuleFor(x => x.Kind).Must(x => x is null || CommunityValidation.EnumName<StationKind>(x));
        RuleFor(x => x.Species).Must(x => x is null || CommunityValidation.EnumName<Species>(x));
        RuleFor(x => x.PhotoKey).Must(x => x is null || CommunityValidation.Key(x));
        RuleFor(x => x.Name).MaximumLength(200).Must(TextRules.HasNoControlCharacters);
    }
}
public sealed class FeedingRequestValidator : AbstractValidator<FeedingRequest>
{
    public FeedingRequestValidator()
    {
        RuleFor(x => x.PhotoKey).Must(x => x is null || CommunityValidation.Key(x));
        RuleFor(x => x.Note).MaximumLength(2000).Must(TextRules.HasNoControlCharacters);
    }
}
