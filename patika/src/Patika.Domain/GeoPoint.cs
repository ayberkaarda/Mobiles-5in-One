namespace Patika.Domain;

public readonly record struct GeoPoint
{
    public GeoPoint(double longitude, double latitude)
    {
        if (!double.IsFinite(longitude) || longitude is < -180 or > 180)
        {
            throw new ArgumentOutOfRangeException(nameof(longitude));
        }

        if (!double.IsFinite(latitude) || latitude is < -90 or > 90)
        {
            throw new ArgumentOutOfRangeException(nameof(latitude));
        }

        Longitude = longitude;
        Latitude = latitude;
    }

    public double Longitude { get; }
    public double Latitude { get; }
}
