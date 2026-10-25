namespace Patika.App.Pages.Urgent;

/// <summary>
/// The home-area card of canvas "AcilAyar": a quiet street pattern, the dashed radius around the area and the
/// pin in the middle. It is an illustration of the radius, not a map of the place; streets move with
/// <see cref="Shift"/> so dragging on the pick screen feels like moving the area.
/// </summary>
public sealed class AreaDrawable : IDrawable
{
    /// <summary>Radius in metres; the circle uses 2 km as the largest size.</summary>
    public int RadiusMeters { get; set; } = 1500;

    public bool HasArea { get; set; } = true;

    /// <summary>Pixel offset of the street pattern (the drag in progress).</summary>
    public PointF Shift { get; set; }

    public void Draw(ICanvas canvas, RectF rect)
    {
        canvas.FillColor = Token("Kum");
        canvas.FillRectangle(rect);

        canvas.SaveState();
        canvas.Translate(Wrap(Shift.X, rect.Width), Wrap(Shift.Y, rect.Height));
        canvas.StrokeColor = Token("Kar");
        canvas.StrokeLineCap = LineCap.Round;
        for (var dx = -1; dx <= 1; dx++)
        {
            for (var dy = -1; dy <= 1; dy++)
            {
                DrawStreets(canvas, rect, dx * rect.Width, dy * rect.Height);
            }
        }

        canvas.RestoreState();

        if (!HasArea)
        {
            return;
        }

        var center = rect.Center;
        var max = Math.Min(rect.Width, rect.Height) * 0.48f;
        var radius = max * Math.Clamp(RadiusMeters / 2000f, 0.2f, 1f);
        canvas.FillColor = Token("Tekir").WithAlpha(0.14f);
        canvas.FillCircle(center, radius);
        canvas.StrokeColor = Token("TekirDeep");
        canvas.StrokeSize = 2;
        canvas.StrokeDashPattern = [6, 6];
        canvas.DrawCircle(center, radius);
        canvas.StrokeDashPattern = null;

        canvas.FillColor = Token("Tekir");
        canvas.FillCircle(center, 9);
        canvas.StrokeColor = Token("Beyaz");
        canvas.StrokeSize = 3;
        canvas.DrawCircle(center, 9);
    }

    private static void DrawStreets(ICanvas canvas, RectF rect, float ox, float oy)
    {
        var w = rect.Width;
        var h = rect.Height;
        var main = new PathF();
        main.MoveTo(ox - 10, oy + (h * 0.75f));
        main.CurveTo(ox + (w * 0.3f), oy + (h * 0.65f), ox + (w * 0.63f), oy + (h * 0.5f), ox + w + 10, oy + (h * 0.25f));
        canvas.StrokeSize = 22;
        canvas.DrawPath(main);

        canvas.StrokeSize = 16;
        canvas.DrawLine(ox + (w * 0.26f), oy - 10, ox + (w * 0.4f), oy + h + 10);
        canvas.DrawLine(ox + (w * 0.71f), oy - 10, ox + (w * 0.8f), oy + h + 10);
        canvas.StrokeSize = 12;
        canvas.DrawLine(ox - 10, oy + (h * 0.25f), ox + w + 10, oy + (h * 0.15f));
    }

    private static float Wrap(float value, float size) => size <= 0 ? 0 : ((value % size) + size) % size;

    private static Color Token(string key) =>
        Application.Current?.Resources.TryGetValue(key, out var value) == true && value is Color color ? color : Colors.Gray;
}
