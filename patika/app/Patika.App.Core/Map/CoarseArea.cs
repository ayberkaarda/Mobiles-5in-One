using Patika.App.Core.Api;

namespace Patika.App.Core.Map;

/// <summary>
/// The query box while the map is centred on the user's own position ("Konumuma git"). Its bounds are whole
/// cells of a fixed 0.01° grid (about 1.1 km by 0.85 km in Türkiye) around the cell the centre falls in, so
/// the server learns only that cell: every point in the same cell gives the very same request, and the box
/// centre is the cell centre, not the user. The exact position stays on the phone (the view is centred
/// locally); it is sent only when the user confirms a station or an urgent call at that spot.
/// </summary>
public static class CoarseArea
{
    public const double Grid = 0.01;

    public static MapArea Around(double latitude, double longitude, MapViewport viewport)
    {
        var cellLat = Math.Floor(Math.Round(latitude / Grid, 9));
        var cellLng = Math.Floor(Math.Round(longitude / Grid, 9));

        // How many cells the view spans at this zoom and size, measured at the cell centre; one more on
        // each side so a view centred anywhere in the cell is covered.
        var centred = viewport.CenterOn((cellLat + 0.5) * Grid, (cellLng + 0.5) * Grid).ToArea(0);
        var spanLat = (int)Math.Ceiling((centred.MaxLatitude - centred.MinLatitude) / 2 / Grid) + 1;
        var spanLng = (int)Math.Ceiling((centred.MaxLongitude - centred.MinLongitude) / 2 / Grid) + 1;

        MapArea Box(int dLat, int dLng) => new(
            Math.Round((cellLat - dLat) * Grid, 2), Math.Round((cellLng - dLng) * Grid, 2),
            Math.Round((cellLat + 1 + dLat) * Grid, 2), Math.Round((cellLng + 1 + dLng) * Grid, 2),
            (int)Math.Floor(viewport.Zoom));

        var box = Box(spanLat, spanLng);
        while (MapViewport.AreaKm2(box) > MapViewport.MaxAreaKm2 && (spanLat > 1 || spanLng > 1))
        {
            // Zoomed far out on a big screen: give up some coverage before the API's area limit.
            spanLat = Math.Max(1, spanLat - 1);
            spanLng = Math.Max(1, spanLng - 1);
            box = Box(spanLat, spanLng);
        }

        return box;
    }
}
