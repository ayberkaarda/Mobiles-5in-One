using Patika.App.Core.Map;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Xunit;

namespace Patika.App.Tests.Map;

public sealed class MapViewportTests
{
    private static readonly MapViewport Moda = new(40.9860, 29.0270, 15, 390, 772);

    [Fact]
    public void The_centre_is_in_the_middle_of_the_view_and_screen_points_round_trip()
    {
        var centre = Moda.ToScreen(Moda.Latitude, Moda.Longitude);
        Assert.Equal(195, centre.X, 6);
        Assert.Equal(386, centre.Y, 6);

        var (lat, lng) = Moda.FromScreen(new ScreenPoint(10, 700));
        var back = Moda.ToScreen(lat, lng);
        Assert.Equal(10, back.X, 6);
        Assert.Equal(700, back.Y, 6);

        // North is up, east is right.
        Assert.True(Moda.ToScreen(Moda.Latitude + 0.001, Moda.Longitude).Y < centre.Y);
        Assert.True(Moda.ToScreen(Moda.Latitude, Moda.Longitude + 0.001).X > centre.X);
    }

    [Fact]
    public void Panning_moves_the_content_with_the_finger()
    {
        var station = (Lat: 40.987, Lng: 29.029);
        var before = Moda.ToScreen(station.Lat, station.Lng);

        var after = Moda.Pan(30, -50).ToScreen(station.Lat, station.Lng);

        Assert.Equal(before.X + 30, after.X, 6);
        Assert.Equal(before.Y - 50, after.Y, 6);
    }

    [Fact]
    public void Pinching_keeps_the_point_under_the_fingers_in_place_and_respects_the_zoom_limits()
    {
        var anchor = new ScreenPoint(80, 600);
        var (lat, lng) = Moda.FromScreen(anchor);

        var zoomed = Moda.ZoomAt(2, anchor);

        Assert.Equal(16, zoomed.Zoom, 6);
        var stays = zoomed.ToScreen(lat, lng);
        Assert.Equal(anchor.X, stays.X, 4);
        Assert.Equal(anchor.Y, stays.Y, 4);
        Assert.Equal(MapViewport.MinZoom, Moda.ZoomAt(1d / 1024, anchor).Zoom);
        Assert.Equal(MapViewport.MaxZoom, Moda.ZoomAt(1024, anchor).Zoom);
    }

    [Fact]
    public void The_query_box_covers_the_view_with_a_margin_and_uses_the_whole_zoom()
    {
        var area = Moda with { Zoom = 15.7 };
        var box = area.ToArea();
        var visible = area.ToArea(0);

        Assert.Equal(15, box.Zoom);
        Assert.True(box.MinLatitude < visible.MinLatitude && box.MaxLatitude > visible.MaxLatitude);
        Assert.True(box.MinLongitude < visible.MinLongitude && box.MaxLongitude > visible.MaxLongitude);
        Assert.True(area.IsCoveredBy(box));
        Assert.False(area.Pan(400, 0).IsCoveredBy(box));
        Assert.False((area with { Zoom = 16.1 }).IsCoveredBy(box));
    }

    [Theory]
    [InlineData(390, 772)]
    [InlineData(1280, 800)]
    [InlineData(2560, 1600)]
    public void The_query_box_never_exceeds_the_api_area_limit_even_fully_zoomed_out(double width, double height)
    {
        var box = new MapViewport(41.0, 29.0, MapViewport.MinZoom, width, height).ToArea();

        Assert.True(AreaKm2(box) <= 400, $"{AreaKm2(box):0} km²");
    }

    [Fact]
    public void Bbox_is_written_lng_lat_in_invariant_culture()
    {
        var previous = Thread.CurrentThread.CurrentCulture;
        Thread.CurrentThread.CurrentCulture = System.Globalization.CultureInfo.GetCultureInfo("tr-TR");
        try
        {
            var box = Moda.ToArea().ToBbox();
            Assert.Matches(@"^29\.\d+,40\.\d+,29\.\d+,4[01]\.\d+$", box);
        }
        finally
        {
            Thread.CurrentThread.CurrentCulture = previous;
        }
    }

    /// <summary>The formula the API validates the box with (GeoRules.AreaKm2).</summary>
    private static double AreaKm2(Patika.App.Core.Api.MapArea box)
    {
        const double KmPerDegree = 111.32;
        var height = (box.MaxLatitude - box.MinLatitude) * KmPerDegree;
        var midLatitude = (box.MaxLatitude + box.MinLatitude) / 2 * Math.PI / 180;
        var width = (box.MaxLongitude - box.MinLongitude) * KmPerDegree * Math.Cos(midLatitude);
        return Math.Abs(height * width);
    }
}

public sealed class MapSceneTests
{
    private static readonly TimeZoneInfo Istanbul = TimeZoneInfo.CreateCustomTimeZone("TRT", TimeSpan.FromHours(3), "TRT", "TRT");
    private static readonly DateTimeOffset Now = new(2026, 10, 25, 9, 0, 0, TimeSpan.Zero);

    private static StationResponse Station(Guid id, string kind = "Food", string status = "Active", DateTimeOffset? fed = null) =>
        new(id, "İstasyon", new CoordinateDto(40.986, 29.027), kind, "Cat", "station/x", status, fed, 3);

    [Fact]
    public void Server_clusters_are_drawn_as_sent_and_singles_get_their_kind_from_the_detail()
    {
        var food = Guid.NewGuid();
        var water = Guid.NewGuid();
        var empty = Guid.NewGuid();
        var unknown = Guid.NewGuid();
        MapFeature[] features =
        [
            new(null, 40.99, 29.02, 12),
            new(null, 40.9901, 29.0201, 5),
            new(food, 40.986, 29.027, 1),
            new(water, 40.987, 29.028, 1),
            new(empty, 40.988, 29.029, 1),
            new(unknown, 40.989, 29.030, 1),
        ];
        var stations = new Dictionary<Guid, StationResponse>
        {
            [food] = Station(food, fed: Now.AddHours(-1)),
            [water] = Station(water, "Water", fed: Now.AddDays(-1)),
            [empty] = Station(empty, "Both", "NeedsRefill"),
        };

        var pins = MapScene.Build(features, stations, selected: water, Now, Istanbul);

        // Two clusters close together stay two clusters with their own counts (ADR-0003).
        Assert.Equal([12, 5], pins.Where(p => p.Kind == PinKind.Cluster).Select(p => p.Count));
        Assert.Equal(PinKind.Food, pins.Single(p => p.Id == food).Kind);
        Assert.True(pins.Single(p => p.Id == food).FedToday);
        Assert.False(pins.Single(p => p.Id == water).FedToday);
        Assert.Equal(PinKind.NeedsRefill, pins.Single(p => p.Id == empty).Kind);
        Assert.Equal(PinKind.Unknown, pins.Single(p => p.Id == unknown).Kind);
        Assert.Equal(water, pins[^1].Id);
        Assert.True(pins[^1].Selected);
        Assert.Equal(PinKind.Cluster, pins[0].Kind);
    }

    [Fact]
    public void A_tap_hits_the_nearest_pin_within_its_touch_radius_and_a_cluster_tap_zooms_in()
    {
        var viewport = new MapViewport(40.986, 29.027, 15, 390, 772);
        var id = Guid.NewGuid();
        var pins = MapScene.Build([new MapFeature(id, 40.986, 29.027, 1), new MapFeature(null, 40.99, 29.03, 9)],
            new Dictionary<Guid, StationResponse>(), null, Now, Istanbul);
        var at = viewport.ToScreen(40.986, 29.027);

        Assert.Equal(id, MapScene.HitTest(pins, viewport, new ScreenPoint(at.X + 20, at.Y))?.Id);
        Assert.Null(MapScene.HitTest(pins, viewport, new ScreenPoint(at.X + 30, at.Y + 30)));

        var cluster = pins.Single(p => p.Kind == PinKind.Cluster);
        var zoomed = MapScene.ZoomInto(viewport with { Zoom = 15.6 }, cluster);
        Assert.Equal(17, zoomed.Zoom);
        Assert.Equal(cluster.Latitude, zoomed.Latitude, 9);
    }

    [Fact]
    public void Filter_chips_toggle_and_map_to_the_api_query()
    {
        var filter = StationFilter.All.Toggle(FilterChip.Cat);
        Assert.Equal(new Patika.App.Core.Api.MapFilter(null, "Cat", null), filter.ToQuery());

        filter = filter.Toggle(FilterChip.Dog).Toggle(FilterChip.Water).Toggle(FilterChip.NeedsRefill);
        Assert.Equal(new Patika.App.Core.Api.MapFilter("Water", "Dog", true), filter.ToQuery());
        Assert.True(filter.IsOn(FilterChip.Dog));
        Assert.False(filter.IsOn(FilterChip.Cat));
        Assert.False(filter.IsOn(FilterChip.All));

        filter = filter.Toggle(FilterChip.Water).Toggle(FilterChip.Food);
        Assert.Equal("Food", filter.Kind);
        Assert.Null(filter.Toggle(FilterChip.All).ToQuery());
        Assert.True(StationFilter.All.IsOn(FilterChip.All));
    }
}
