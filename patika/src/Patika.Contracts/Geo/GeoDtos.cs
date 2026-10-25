using System.Text.Json.Serialization;

namespace Patika.Contracts.Geo;

public sealed record CoordinateDto(
    [property: JsonPropertyName("lat")] double Latitude,
    [property: JsonPropertyName("lng")] double Longitude);

public sealed record BoundingBoxQuery(double MinLatitude, double MinLongitude, double MaxLatitude, double MaxLongitude);

public sealed record NearQuery(double Latitude, double Longitude, int RadiusMeters);
