using Patika.App.Core.Map;

namespace Patika.App.Drawing;

/// <summary>
/// Draws the station map (ADR-0007): a plain Kum ground with a light grid that moves with the map, the
/// server's clusters and stations as pins in the canvas style, the user's position when they asked for
/// it, and in pin-drop mode a fixed pin at the centre. There is no street layer (see ADR-0007).
/// </summary>
public sealed class StationMapDrawable : IDrawable
{
    private const double GridStep = 64;

    public MapViewport Viewport { get; set; } = MapViewport.Default();

    public IReadOnlyList<MapPin> Pins { get; set; } = [];

    /// <summary>Held in memory for drawing only, never stored.</summary>
    public (double Latitude, double Longitude)? UserLocation { get; set; }

    public bool ShowCenterPin { get; set; }

    private static Color Token(string key) =>
        Application.Current?.Resources.TryGetValue(key, out var value) == true && value is Color color ? color : Colors.Gray;

    public void Draw(ICanvas canvas, RectF dirtyRect)
    {
        var viewport = Viewport.Resize(dirtyRect.Width, dirtyRect.Height);
        canvas.FillColor = Token("Kum");
        canvas.FillRectangle(dirtyRect);
        DrawGrid(canvas, viewport, dirtyRect);

        foreach (var pin in Pins)
        {
            var at = viewport.ToScreen(pin.Latitude, pin.Longitude);
            if (at.X < -40 || at.Y < -40 || at.X > dirtyRect.Width + 40 || at.Y > dirtyRect.Height + 40)
            {
                continue;
            }

            canvas.SaveState();
            canvas.Translate((float)at.X, (float)at.Y);
            DrawPin(canvas, pin);
            canvas.RestoreState();
        }

        if (UserLocation is { } user)
        {
            var at = viewport.ToScreen(user.Latitude, user.Longitude);
            canvas.FillColor = Token("Boncuk").WithAlpha(0.2f);
            canvas.FillCircle((float)at.X, (float)at.Y, 20);
            canvas.FillColor = Token("Beyaz");
            canvas.FillCircle((float)at.X, (float)at.Y, 10);
            canvas.FillColor = Token("Boncuk");
            canvas.FillCircle((float)at.X, (float)at.Y, 7);
        }

        if (ShowCenterPin)
        {
            DrawDropPin(canvas, dirtyRect.Width / 2, dirtyRect.Height / 2);
        }
    }

    /// <summary>Grid lines on world coordinates so panning visibly moves the ground.</summary>
    private static void DrawGrid(ICanvas canvas, MapViewport viewport, RectF rect)
    {
        var origin = viewport.ToScreen(0, 0);
        var offsetX = ((origin.X % GridStep) + GridStep) % GridStep;
        var offsetY = ((origin.Y % GridStep) + GridStep) % GridStep;
        canvas.StrokeColor = Token("Cizgi");
        canvas.StrokeSize = 1;
        for (var x = offsetX; x < rect.Width; x += GridStep)
        {
            canvas.DrawLine((float)x, 0, (float)x, rect.Height);
        }

        for (var y = offsetY; y < rect.Height; y += GridStep)
        {
            canvas.DrawLine(0, (float)y, rect.Width, (float)y);
        }
    }

    private static void DrawPin(ICanvas canvas, MapPin pin)
    {
        if (pin.Selected)
        {
            canvas.FillColor = Token("Tekir").WithAlpha(0.25f);
            canvas.FillCircle(0, 0, 31);
        }

        switch (pin.Kind)
        {
            case PinKind.Cluster:
                var outer = (float)pin.ClusterRadius;
                Disc(canvas, outer, outer - 4, Token("Kaldirim"));
                canvas.FontColor = Token("Kar");
                canvas.Font = Microsoft.Maui.Graphics.Font.DefaultBold;
                canvas.FontSize = pin.Count < 10 ? 15 : 17;
                var label = pin.Count > 999 ? "999+" : pin.Count.ToString(System.Globalization.CultureInfo.InvariantCulture);
                canvas.DrawString(label, -outer, -outer, outer * 2, outer * 2, HorizontalAlignment.Center, VerticalAlignment.Center);
                break;
            case PinKind.Water:
                Disc(canvas, 21, 17, Token("Nane"));
                canvas.FillColor = Token("Beyaz");
                canvas.FillPath(Drop());
                break;
            case PinKind.NeedsRefill:
                canvas.FillColor = Token("Beyaz");
                canvas.FillCircle(0, 0, 20);
                canvas.StrokeColor = Token("Tekir");
                canvas.StrokeSize = 3;
                canvas.StrokeDashPattern = [5f / 3, 4f / 3];
                canvas.DrawCircle(0, 0, 20);
                canvas.StrokeDashPattern = null;
                canvas.StrokeColor = Token("TekirDeep");
                canvas.StrokeSize = 2.2f;
                canvas.StrokeLineJoin = LineJoin.Round;
                canvas.DrawPath(EmptyBowl());
                break;
            case PinKind.Unknown:
                Disc(canvas, 21, 17, Token("SisLight"));
                canvas.FillColor = Token("Beyaz");
                canvas.FillCircle(0, 0, 5);
                break;
            default:
                Disc(canvas, 23, 19, Token("Tekir"));
                canvas.FillColor = Token("Beyaz");
                canvas.FillPath(Bowl());
                foreach (var (x, y) in new[] { (-4.1f, -4.5f), (0.8f, -6.2f), (4.5f, -3.7f) })
                {
                    canvas.FillCircle(x, y, 1.9f);
                }

                break;
        }

        if (pin.FedToday && pin.Kind is PinKind.Food or PinKind.Water)
        {
            // Green check badge: fed today.
            canvas.FillColor = Token("NaneDeep");
            canvas.FillCircle(14, -14, 8);
            canvas.StrokeColor = Token("Beyaz");
            canvas.StrokeSize = 2.2f;
            canvas.DrawCircle(14, -14, 8);
            canvas.StrokeSize = 2;
            canvas.StrokeLineCap = LineCap.Round;
            canvas.StrokeLineJoin = LineJoin.Round;
            var check = new PathF();
            check.MoveTo(10.5f, -14);
            check.LineTo(13, -11.5f);
            check.LineTo(17.5f, -16.5f);
            canvas.DrawPath(check);
        }
    }

    private static void Disc(ICanvas canvas, float ring, float inner, Color fill)
    {
        canvas.FillColor = Token("Beyaz");
        canvas.FillCircle(0, 0, ring);
        canvas.FillColor = fill;
        canvas.FillCircle(0, 0, inner);
    }

    private static PathF Bowl()
    {
        var path = new PathF();
        path.AppendRectangle(-9, -1.2f, 18, 2.4f);
        path.MoveTo(-7.4f, 2.6f);
        path.LineTo(7.4f, 2.6f);
        path.CurveTo(6.6f, 6.6f, 3.7f, 8.2f, 0, 8.2f);
        path.CurveTo(-3.7f, 8.2f, -6.6f, 6.6f, -7.4f, 2.6f);
        path.Close();
        return path;
    }

    private static PathF EmptyBowl()
    {
        var path = new PathF();
        path.MoveTo(-8, -2.5f);
        path.LineTo(8, -2.5f);
        path.LineTo(5.5f, 5.5f);
        path.LineTo(-5.5f, 5.5f);
        path.Close();
        return path;
    }

    private static PathF Drop()
    {
        const float K = 3.59f; // 0.5523 * 6.5: a quarter circle as a cubic curve
        var path = new PathF();
        path.MoveTo(0, -9);
        path.CurveTo(4, -3, 6.5f, 0, 6.5f, 3.5f);
        path.CurveTo(6.5f, 3.5f + K, K, 10, 0, 10);
        path.CurveTo(-K, 10, -6.5f, 3.5f + K, -6.5f, 3.5f);
        path.CurveTo(-6.5f, 0, -4, -3, 0, -9);
        path.Close();
        return path;
    }

    /// <summary>The pin-drop marker of "İstasyon ekle": its tip is the exact centre of the map.</summary>
    private static void DrawDropPin(ICanvas canvas, float x, float y)
    {
        canvas.FillColor = Token("Kaldirim").WithAlpha(0.2f);
        canvas.FillEllipse(x - 8, y - 3, 16, 6);
        var pin = new PathF();
        pin.MoveTo(x, y);
        pin.CurveTo(x - 4, y - 10, x - 16, y - 18, x - 16, y - 30);
        pin.CurveTo(x - 16, y - 39, x - 9, y - 46, x, y - 46);
        pin.CurveTo(x + 9, y - 46, x + 16, y - 39, x + 16, y - 30);
        pin.CurveTo(x + 16, y - 18, x + 4, y - 10, x, y);
        pin.Close();
        canvas.FillColor = Token("Tekir");
        canvas.FillPath(pin);
        canvas.StrokeColor = Token("Beyaz");
        canvas.StrokeSize = 2;
        canvas.DrawPath(pin);
        canvas.FillColor = Token("Beyaz");
        canvas.FillCircle(x, y - 30, 6);
    }
}
