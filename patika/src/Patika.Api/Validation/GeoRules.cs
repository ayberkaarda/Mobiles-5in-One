using FluentValidation;
using Patika.Contracts.Geo;

namespace Patika.Api.Validation;

/// <summary>Coordinate rules shared by every endpoint that accepts locations.</summary>
public static class GeoRules
{
    // Türkiye bounding box with a small margin for coastal and border districts.
    public const double MinLatitude = 35.80;
    public const double MaxLatitude = 42.20;
    public const double MinLongitude = 25.60;
    public const double MaxLongitude = 44.90;
    public const double MaxBoundingBoxAreaKm2 = 400;
    public const int MaxRadiusMeters = 5000;
    private const double KmPerDegree = 111.32;

    public static bool IsValidCoordinate(double latitude, double longitude) =>
        double.IsFinite(latitude) && double.IsFinite(longitude)
        && latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;

    public static bool IsInsideTurkey(double latitude, double longitude) =>
        IsValidCoordinate(latitude, longitude)
        && latitude is >= MinLatitude and <= MaxLatitude
        && longitude is >= MinLongitude and <= MaxLongitude;

    public static double AreaKm2(BoundingBoxQuery box)
    {
        var height = (box.MaxLatitude - box.MinLatitude) * KmPerDegree;
        var midLatitude = (box.MaxLatitude + box.MinLatitude) / 2 * Math.PI / 180;
        var width = (box.MaxLongitude - box.MinLongitude) * KmPerDegree * Math.Cos(midLatitude);
        return Math.Abs(height * width);
    }
}

/// <summary>A location for creating a record: valid and inside Türkiye.</summary>
public sealed class CoordinateValidator : AbstractValidator<CoordinateDto>
{
    public CoordinateValidator()
    {
        RuleFor(c => c)
            .Must(c => GeoRules.IsValidCoordinate(c.Latitude, c.Longitude))
            .WithName("location").WithMessage("Coordinates are not valid.")
            .Must(c => GeoRules.IsInsideTurkey(c.Latitude, c.Longitude))
            .WithName("location").WithMessage("Location must be inside Türkiye.");
    }
}

public sealed class BoundingBoxValidator : AbstractValidator<BoundingBoxQuery>
{
    public BoundingBoxValidator()
    {
        RuleFor(b => b)
            .Must(b => GeoRules.IsValidCoordinate(b.MinLatitude, b.MinLongitude)
                && GeoRules.IsValidCoordinate(b.MaxLatitude, b.MaxLongitude))
            .WithName("bbox").WithMessage("Bounding box coordinates are not valid.")
            .Must(b => b.MinLatitude < b.MaxLatitude && b.MinLongitude < b.MaxLongitude)
            .WithName("bbox").WithMessage("Bounding box minimums must be below maximums.")
            .Must(b => GeoRules.AreaKm2(b) <= GeoRules.MaxBoundingBoxAreaKm2)
            .WithName("bbox").WithMessage("Bounding box area must not exceed 400 km².");
    }
}

public sealed class NearQueryValidator : AbstractValidator<NearQuery>
{
    public NearQueryValidator()
    {
        RuleFor(q => q)
            .Must(q => GeoRules.IsValidCoordinate(q.Latitude, q.Longitude))
            .WithName("near").WithMessage("Coordinates are not valid.");
        RuleFor(q => q.RadiusMeters)
            .InclusiveBetween(1, GeoRules.MaxRadiusMeters).WithName("radius");
    }
}
