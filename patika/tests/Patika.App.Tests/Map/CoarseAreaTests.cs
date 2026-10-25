using Patika.App.Core.Map;
using Xunit;

namespace Patika.App.Tests.Map;

public sealed class CoarseAreaTests
{
    private static readonly MapViewport View = new(41.0, 29.0, 15.5, 390, 772);

    [Fact]
    public void Nearby_fixes_in_the_same_cell_send_the_identical_box_whose_centre_is_not_the_user()
    {
        var a = (Lat: 40.98612, Lng: 29.02734);
        var b = (Lat: 40.98197, Lng: 29.02011);

        var first = CoarseArea.Around(a.Lat, a.Lng, View.CenterOn(a.Lat, a.Lng));
        var second = CoarseArea.Around(b.Lat, b.Lng, View.CenterOn(b.Lat, b.Lng));

        Assert.Equal(first, second);
        Assert.Equal(first.ToBbox(), second.ToBbox());
        Assert.Equal(40.985, (first.MinLatitude + first.MaxLatitude) / 2, 6);
        Assert.Equal(29.025, (first.MinLongitude + first.MaxLongitude) / 2, 6);
        Assert.NotEqual(a.Lat, (first.MinLatitude + first.MaxLatitude) / 2, 3);
        foreach (var edge in new[] { first.MinLatitude, first.MaxLatitude, first.MinLongitude, first.MaxLongitude })
        {
            Assert.Equal(Math.Round(edge, 2), edge, 9); // whole grid cells only
        }
    }

    [Fact]
    public void The_box_covers_a_view_centred_anywhere_in_the_cell_and_the_next_cell_gives_another_box()
    {
        foreach (var (lat, lng) in new[] { (40.98001, 29.02001), (40.98999, 29.02999), (40.985, 29.025) })
        {
            var view = View.CenterOn(lat, lng);
            Assert.True(view.IsCoveredBy(CoarseArea.Around(lat, lng, view)), $"{lat},{lng}");
        }

        Assert.NotEqual(CoarseArea.Around(40.98999, 29.025, View), CoarseArea.Around(40.99001, 29.025, View));
    }

    [Theory]
    [InlineData(12, 390, 772)]
    [InlineData(12, 1280, 800)]
    [InlineData(19, 390, 772)]
    public void The_box_stays_within_the_api_area_limit(double zoom, double width, double height)
    {
        var view = new MapViewport(41.0, 29.0, zoom, width, height);
        Assert.True(MapViewport.AreaKm2(CoarseArea.Around(41.0004, 29.0007, view)) <= 400);
    }
}
