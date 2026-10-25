using System.Text.Json;
using System.Text.Json.Serialization;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;

namespace Patika.App.Core.Api;

internal static class ApiJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

public sealed record FeedingDraft(string? PhotoKey = null, string? Note = null);

/// <summary>Body of <c>GET /v1/stations/{id}</c>.</summary>
public sealed record StationDetail(StationResponse Station, IReadOnlyList<FeedingResponse> Feedings);

/// <summary>A map viewport in degrees.</summary>
public sealed record MapArea(double MinLatitude, double MinLongitude, double MaxLatitude, double MaxLongitude, int Zoom)
{
    /// <summary>The API's <c>bbox</c>: <c>minLng,minLat,maxLng,maxLat</c>, invariant culture.</summary>
    public string ToBbox() => string.Create(System.Globalization.CultureInfo.InvariantCulture,
        $"{MinLongitude:0.######},{MinLatitude:0.######},{MaxLongitude:0.######},{MaxLatitude:0.######}");

    /// <summary>A square of about <paramref name="radiusMeters"/> around a point.</summary>
    public static MapArea Around(CoordinateDto center, double radiusMeters, int zoom)
    {
        const double MetersPerDegree = 111_320d;
        var dLat = radiusMeters / MetersPerDegree;
        var dLng = radiusMeters / (MetersPerDegree * Math.Max(0.1, Math.Cos(center.Latitude * Math.PI / 180)));
        return new MapArea(center.Latitude - dLat, center.Longitude - dLng, center.Latitude + dLat, center.Longitude + dLng, zoom);
    }
}

/// <summary>Optional map filters, matching the API's query names.</summary>
public sealed record MapFilter(string? Kind = null, string? Species = null, bool? NeedsRefill = null);
