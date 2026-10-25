using Patika.App.Core.Api;

namespace Patika.App.Core.Map;

/// <summary>A point on screen, in device-independent units from the top left of the map view.</summary>
public readonly record struct ScreenPoint(double X, double Y);

/// <summary>
/// What the map view shows: a centre, a fractional zoom and the view size. Web Mercator with 256-unit
/// tiles, the same zoom scale the API's grid clusters use (ADR-0003), so a cluster cell is about 64 units
/// on screen. Immutable: every gesture returns a new viewport.
/// </summary>
public sealed record MapViewport(double Latitude, double Longitude, double Zoom, double Width, double Height)
{
    /// <summary>
    /// The API refuses boxes over 400 km²; at zoom 12 a phone screen covers about 250 km² in Türkiye,
    /// so the map never zooms out further than that.
    /// </summary>
    public const double MinZoom = 12;

    public const double MaxZoom = 19;

    private const double TileSize = 256;
    private const double MaxLatitude = 85.05112878;

    /// <summary>Moda, Kadıköy: where the canvas is drawn, used until the user asks for their location.</summary>
    public static MapViewport Default(double width = 390, double height = 772) => new(40.9860, 29.0270, 15.5, width, height);

    private double WorldSize => TileSize * Math.Pow(2, Zoom);

    public MapViewport Resize(double width, double height) => this with { Width = Math.Max(1, width), Height = Math.Max(1, height) };

    public ScreenPoint ToScreen(double latitude, double longitude)
    {
        var (cx, cy) = Project(Latitude, Longitude, WorldSize);
        var (x, y) = Project(latitude, longitude, WorldSize);
        return new ScreenPoint(x - cx + (Width / 2), y - cy + (Height / 2));
    }

    public (double Latitude, double Longitude) FromScreen(ScreenPoint point)
    {
        var (cx, cy) = Project(Latitude, Longitude, WorldSize);
        return Unproject(cx + point.X - (Width / 2), cy + point.Y - (Height / 2), WorldSize);
    }

    /// <summary>Moves the map with the finger: content follows (dx, dy).</summary>
    public MapViewport Pan(double dx, double dy)
    {
        var (lat, lng) = FromScreen(new ScreenPoint((Width / 2) - dx, (Height / 2) - dy));
        return this with { Latitude = Math.Clamp(lat, -MaxLatitude, MaxLatitude), Longitude = WrapLongitude(lng) };
    }

    /// <summary>Zooms by <paramref name="factor"/> keeping the point under <paramref name="anchor"/> in place.</summary>
    public MapViewport ZoomAt(double factor, ScreenPoint anchor)
    {
        if (factor <= 0 || double.IsNaN(factor))
        {
            return this;
        }

        var zoom = Math.Clamp(Zoom + Math.Log2(factor), MinZoom, MaxZoom);
        var (lat, lng) = FromScreen(anchor);
        var zoomed = this with { Zoom = zoom };

        // Keep (lat, lng) under the finger: shift the centre by how far it drifted.
        var drifted = zoomed.ToScreen(lat, lng);
        return zoomed.Pan(anchor.X - drifted.X, anchor.Y - drifted.Y);
    }

    public MapViewport CenterOn(double latitude, double longitude, double? zoom = null) => this with
    {
        Latitude = Math.Clamp(latitude, -MaxLatitude, MaxLatitude),
        Longitude = WrapLongitude(longitude),
        Zoom = Math.Clamp(zoom ?? Zoom, MinZoom, MaxZoom),
    };

    /// <summary>
    /// The query area: the visible box plus a margin of a quarter view on each side, so short pans do
    /// not refetch, and the integer zoom the server clusters on.
    /// </summary>
    public MapArea ToArea(double margin = 0.25)
    {
        // Stay under the API's 400 km² limit: shrink the margin first, then the box itself (a large tablet).
        var visibleKm2 = Width * Height * MetersPerUnit * MetersPerUnit / 1_000_000;
        var scale = 1 + (2 * Math.Max(0, margin));
        if (visibleKm2 * scale * scale > MaxAreaKm2)
        {
            scale = Math.Sqrt(MaxAreaKm2 / visibleKm2);
        }

        var halfWidth = Width * scale / 2;
        var halfHeight = Height * scale / 2;
        var (north, west) = FromScreen(new ScreenPoint((Width / 2) - halfWidth, (Height / 2) - halfHeight));
        var (south, east) = FromScreen(new ScreenPoint((Width / 2) + halfWidth, (Height / 2) + halfHeight));
        return new MapArea(south, west, north, east, (int)Math.Floor(Zoom));
    }

    /// <summary>Below the API's 400 km² so rounding of the box never tips it over.</summary>
    public const double MaxAreaKm2 = 380;

    /// <summary>The area of a box as the API measures it (GeoRules.AreaKm2).</summary>
    public static double AreaKm2(MapArea box)
    {
        const double KmPerDegree = 111.32;
        var height = (box.MaxLatitude - box.MinLatitude) * KmPerDegree;
        var midLatitude = (box.MaxLatitude + box.MinLatitude) / 2 * Math.PI / 180;
        var width = (box.MaxLongitude - box.MinLongitude) * KmPerDegree * Math.Cos(midLatitude);
        return Math.Abs(height * width);
    }

    /// <summary>True when <paramref name="area"/> still covers everything this viewport shows.</summary>
    public bool IsCoveredBy(MapArea area)
    {
        var visible = ToArea(0);
        return visible.Zoom == area.Zoom && visible.MinLatitude >= area.MinLatitude && visible.MaxLatitude <= area.MaxLatitude
            && visible.MinLongitude >= area.MinLongitude && visible.MaxLongitude <= area.MaxLongitude;
    }

    /// <summary>Metres per screen unit at the centre, for the scale bar.</summary>
    public double MetersPerUnit => 156_543.03392 * Math.Cos(Latitude * Math.PI / 180) / Math.Pow(2, Zoom);

    private static (double X, double Y) Project(double latitude, double longitude, double world)
    {
        var lat = Math.Clamp(latitude, -MaxLatitude, MaxLatitude) * Math.PI / 180;
        var x = (longitude + 180) / 360 * world;
        var y = (1 - (Math.Log(Math.Tan(lat) + (1 / Math.Cos(lat))) / Math.PI)) / 2 * world;
        return (x, y);
    }

    private static (double Latitude, double Longitude) Unproject(double x, double y, double world)
    {
        var lng = (x / world * 360) - 180;
        var n = Math.PI - (2 * Math.PI * y / world);
        var lat = 180 / Math.PI * Math.Atan(Math.Sinh(n));
        return (lat, lng);
    }

    private static double WrapLongitude(double longitude) => ((longitude + 540) % 360) - 180;
}
