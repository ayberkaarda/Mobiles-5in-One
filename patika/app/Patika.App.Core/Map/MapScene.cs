using Patika.App.Core.Api;
using Patika.Contracts.Community;

namespace Patika.App.Core.Map;

/// <summary>How a pin is drawn (canvas "Main").</summary>
public enum PinKind
{
    /// <summary>A server grid cell with several stations: dark disc with the count.</summary>
    Cluster,

    /// <summary>Food, or food and water: Tekir disc with a bowl.</summary>
    Food,

    /// <summary>Water only: Nane disc with a drop.</summary>
    Water,

    /// <summary>Someone marked it "Mama bitti": white disc, dashed Tekir ring, outlined bowl.</summary>
    NeedsRefill,

    /// <summary>A single station whose detail has not loaded yet.</summary>
    Unknown,
}

/// <summary>One thing to draw. <see cref="Id"/> is null for clusters.</summary>
public sealed record MapPin(Guid? Id, double Latitude, double Longitude, int Count, PinKind Kind, bool FedToday, bool Selected)
{
    /// <summary>Touch radius in screen units; at least 24 so every pin is a 48-unit target.</summary>
    public double HitRadius => Kind == PinKind.Cluster ? Math.Max(24, ClusterRadius + 4) : 24;

    /// <summary>Outer radius of a cluster disc, growing slowly with the count.</summary>
    public double ClusterRadius => Count switch { < 10 => 23, < 100 => 27, _ => 31 };

    /// <summary>Spoken by TalkBack for the pin.</summary>
    public string Description => Kind switch
    {
        PinKind.Cluster => $"{Count} istasyon, yakınlaştırmak için dokun",
        PinKind.Water => FedToday ? "Su istasyonu, bugün beslendi" : "Su istasyonu",
        PinKind.NeedsRefill => "İstasyon, mama bitti",
        PinKind.Unknown => "İstasyon",
        _ => FedToday ? "Mama istasyonu, bugün beslendi" : "Mama istasyonu",
    };
}

/// <summary>Turns the server's features (ADR-0003: clusters as sent, never merged here) into pins.</summary>
public static class MapScene
{
    public static IReadOnlyList<MapPin> Build(IReadOnlyList<MapFeature> features,
        IReadOnlyDictionary<Guid, StationResponse> stations, Guid? selected, DateTimeOffset now, TimeZoneInfo zone)
    {
        var pins = new List<MapPin>(features.Count);
        foreach (var feature in features)
        {
            if (feature.Id is not { } id)
            {
                pins.Add(new MapPin(null, feature.Latitude, feature.Longitude, feature.Count, PinKind.Cluster, false, false));
                continue;
            }

            stations.TryGetValue(id, out var station);
            pins.Add(new MapPin(id, feature.Latitude, feature.Longitude, 1, KindOf(station),
                station is not null && StationText.IsToday(station.LastFedAt, now, zone), id == selected));
        }

        // Clusters below singles, the selected pin on top.
        return [.. pins.OrderBy(p => p.Kind == PinKind.Cluster ? 0 : p.Selected ? 2 : 1)];
    }

    public static PinKind KindOf(StationResponse? station) => station switch
    {
        null => PinKind.Unknown,
        { Status: "NeedsRefill" } => PinKind.NeedsRefill,
        { Kind: "Water" } => PinKind.Water,
        _ => PinKind.Food,
    };

    /// <summary>The top-most pin under the finger, or null.</summary>
    public static MapPin? HitTest(IReadOnlyList<MapPin> pins, MapViewport viewport, ScreenPoint point)
    {
        MapPin? best = null;
        var bestDistance = double.MaxValue;
        for (var i = pins.Count - 1; i >= 0; i--)
        {
            var pin = pins[i];
            var at = viewport.ToScreen(pin.Latitude, pin.Longitude);
            var distance = Math.Sqrt(((at.X - point.X) * (at.X - point.X)) + ((at.Y - point.Y) * (at.Y - point.Y)));
            if (distance <= pin.HitRadius && distance < bestDistance)
            {
                best = pin;
                bestDistance = distance;
            }
        }

        return best;
    }

    /// <summary>Tapping a cluster zooms in two levels on it, so the server splits it into smaller cells.</summary>
    public static MapViewport ZoomInto(MapViewport viewport, MapPin cluster) =>
        viewport.CenterOn(cluster.Latitude, cluster.Longitude, Math.Min(MapViewport.MaxZoom, Math.Floor(viewport.Zoom) + 2));
}

/// <summary>Map filter chips: Hepsi, Kedi, Köpek, Mama, Su, Mama bitti. One species and one kind at a time.</summary>
public sealed record StationFilter(string? Species = null, string? Kind = null, bool NeedsRefill = false)
{
    public static StationFilter All { get; } = new();

    public bool IsAll => Species is null && Kind is null && !NeedsRefill;

    /// <summary>Tapping a chip turns it on, or off when it was on; Kedi and Köpek (Mama and Su) exclude each other.</summary>
    public StationFilter Toggle(FilterChip chip) => chip switch
    {
        FilterChip.All => All,
        FilterChip.Cat => this with { Species = Species == "Cat" ? null : "Cat" },
        FilterChip.Dog => this with { Species = Species == "Dog" ? null : "Dog" },
        FilterChip.Food => this with { Kind = Kind == "Food" ? null : "Food" },
        FilterChip.Water => this with { Kind = Kind == "Water" ? null : "Water" },
        FilterChip.NeedsRefill => this with { NeedsRefill = !NeedsRefill },
        _ => this,
    };

    public bool IsOn(FilterChip chip) => chip switch
    {
        FilterChip.All => IsAll,
        FilterChip.Cat => Species == "Cat",
        FilterChip.Dog => Species == "Dog",
        FilterChip.Food => Kind == "Food",
        FilterChip.Water => Kind == "Water",
        FilterChip.NeedsRefill => NeedsRefill,
        _ => false,
    };

    /// <summary>The API query; the server matches kind and species exactly.</summary>
    public MapFilter? ToQuery() => IsAll ? null : new MapFilter(Kind, Species, NeedsRefill ? true : null);
}

public enum FilterChip
{
    All,
    Cat,
    Dog,
    Food,
    Water,
    NeedsRefill,
}
