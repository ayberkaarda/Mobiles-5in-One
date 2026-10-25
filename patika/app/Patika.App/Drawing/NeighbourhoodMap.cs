namespace Patika.App.Drawing;

/// <summary>
/// Stand-in for the real map in phase 0: the same Moda illustration as the web home page,
/// drawn with brand tokens. Streets, park, stations and the volunteer's dotted trail.
/// </summary>
public sealed class NeighbourhoodMap : IDrawable
{
    private const float ArtWidth = 900f;
    private const float ArtHeight = 660f;

    private static Color Token(string key) =>
        Application.Current?.Resources.TryGetValue(key, out var value) == true && value is Color color
            ? color
            : Colors.Magenta;

    public void Draw(ICanvas canvas, RectF dirtyRect)
    {
        // Portrait phones show the part of the art where the trail runs (x 130..770);
        // streets continue past the art edges so the view is always covered.
        var scale = Math.Min(Math.Max(dirtyRect.Width / ArtWidth, dirtyRect.Height / ArtHeight), dirtyRect.Width / 640f);
        var offsetX = (dirtyRect.Width / 2f) - (450f * scale);
        var offsetY = (dirtyRect.Height * 0.42f) - (390f * scale);

        canvas.FillColor = Token("Kum");
        canvas.FillRectangle(dirtyRect);

        canvas.SaveState();
        canvas.Translate(offsetX, offsetY);
        canvas.Scale(scale, scale);

        DrawPark(canvas);
        DrawStreets(canvas);
        DrawTrail(canvas);
        DrawStations(canvas);

        canvas.RestoreState();
    }

    private static void DrawPark(ICanvas canvas)
    {
        var park = new PathF();
        park.MoveTo(560, 520);
        park.CurveTo(620, 480, 760, 470, 900, 500);
        park.LineTo(900, 1400);
        park.LineTo(520, 1400);
        park.LineTo(520, 660);
        park.CurveTo(515, 600, 530, 545, 560, 520);
        park.Close();
        canvas.FillColor = Token("NaneSoft");
        canvas.FillPath(park);

        canvas.FillColor = Token("Nane").WithAlpha(0.55f);
        foreach (var (x, y, r) in new[] { (600f, 560f, 9f), (628f, 545f, 12f), (680f, 530f, 10f), (715f, 560f, 13f), (590f, 610f, 12f), (660f, 600f, 9f), (730f, 620f, 10f), (790f, 545f, 12f), (840f, 600f, 10f) })
        {
            canvas.FillCircle(x, y, r);
        }
    }

    private static void DrawStreets(ICanvas canvas)
    {
        canvas.StrokeColor = Token("Kar");
        canvas.StrokeLineCap = LineCap.Round;

        Street(canvas, 38, (-20, 520), (200, 470), (420, 420), (920, 260));
        Street(canvas, 26, (120, -20), (160, 200), (230, 420), (300, 680));
        Street(canvas, 26, (460, -20), (470, 200), (500, 420), (540, 680));
        Street(canvas, 26, (-20, 220), (250, 200), (500, 160), (920, 100));
        Street(canvas, 18, (640, -20), (640, 160), (650, 250), (690, 330));

        // Straight continuations beyond the art edges.
        canvas.StrokeSize = 26;
        canvas.DrawLine(120, -20, 70, -700);
        canvas.DrawLine(300, 680, 400, 1400);
        canvas.DrawLine(460, -20, 450, -700);
        canvas.StrokeSize = 18;
        canvas.DrawLine(640, -20, 640, -700);

        canvas.StrokeSize = 11;
        canvas.DrawLine(170, 330, 320, 312);
        canvas.DrawLine(300, 120, 330, 330);
        canvas.DrawLine(40, 360, 160, 345);
        canvas.DrawLine(330, 560, 520, 520);
        canvas.DrawLine(690, 330, 920, 300);
    }

    private static void Street(ICanvas canvas, float width, (float X, float Y) start, (float X, float Y) c1, (float X, float Y) c2, (float X, float Y) end)
    {
        var path = new PathF();
        path.MoveTo(start.X, start.Y);
        path.CurveTo(c1.X, c1.Y, c2.X, c2.Y, end.X, end.Y);
        canvas.StrokeSize = width;
        canvas.DrawPath(path);
    }

    private static void DrawTrail(ICanvas canvas)
    {
        var trail = new PathF();
        trail.MoveTo(70, 680);
        trail.CurveTo(110, 590, 190, 520, 250, 470);
        trail.CurveTo(305, 425, 160, 360, 200, 300);
        trail.CurveTo(240, 240, 400, 255, 480, 210);
        trail.CurveTo(575, 160, 655, 300, 630, 470);

        canvas.StrokeColor = Token("Tekir");
        canvas.StrokeSize = 7;
        canvas.StrokeLineCap = LineCap.Round;
        canvas.StrokeDashPattern = [0f, 2.4f];
        canvas.DrawPath(trail);
        canvas.StrokeDashPattern = null;
    }

    private static void DrawStations(ICanvas canvas)
    {
        var white = Token("Beyaz");

        // Fed food station with a green check.
        Pin(canvas, 250, 470, 24, Token("Tekir"), white);
        Bowl(canvas, 250, 470, white, filled: true);
        canvas.FillColor = white;
        canvas.FillCircle(268, 452, 11);
        canvas.FillColor = Token("NaneDeep");
        canvas.FillCircle(268, 452, 8.5f);
        canvas.StrokeColor = white;
        canvas.StrokeSize = 2.4f;
        canvas.StrokeDashPattern = null;
        canvas.DrawLine(264, 452, 267, 455);
        canvas.DrawLine(267, 455, 272, 449);

        // Water station.
        Pin(canvas, 200, 300, 24, Token("Nane"), white);
        var drop = new PathF();
        drop.MoveTo(200, 288);
        drop.CurveTo(206, 296, 209, 300, 209, 305);
        drop.CurveTo(209, 315, 191, 315, 191, 305);
        drop.CurveTo(191, 300, 194, 296, 200, 288);
        drop.Close();
        canvas.FillColor = white;
        canvas.FillPath(drop);

        // Empty station: dashed orange ring.
        canvas.FillColor = white;
        canvas.FillCircle(480, 210, 24);
        canvas.StrokeColor = Token("Tekir");
        canvas.StrokeSize = 3.5f;
        canvas.StrokeDashPattern = [1.6f, 1.2f];
        canvas.DrawCircle(480, 210, 23);
        canvas.StrokeDashPattern = null;
        Bowl(canvas, 480, 210, Token("TekirDeep"), filled: false);

        // Urgent help.
        Pin(canvas, 630, 470, 26, Token("Acil"), white);
        canvas.FillColor = white;
        canvas.FillRectangle(626, 458, 8, 24);
        canvas.FillRectangle(618, 466, 24, 8);
    }

    private static void Pin(ICanvas canvas, float x, float y, float r, Color fill, Color ring)
    {
        canvas.FillColor = ring;
        canvas.FillCircle(x, y, r + 4);
        canvas.FillColor = fill;
        canvas.FillCircle(x, y, r);
    }

    private static void Bowl(ICanvas canvas, float x, float y, Color color, bool filled)
    {
        var bowl = new PathF();
        bowl.MoveTo(x - 9, y + 3);
        bowl.LineTo(x + 9, y + 3);
        bowl.CurveTo(x + 8, y + 8, x + 4.5f, y + 10, x, y + 10);
        bowl.CurveTo(x - 4.5f, y + 10, x - 8, y + 8, x - 9, y + 3);
        bowl.Close();

        if (filled)
        {
            canvas.FillColor = color;
            canvas.FillPath(bowl);
            canvas.FillRectangle(x - 11, y - 1.5f, 22, 3);
            canvas.FillCircle(x - 5, y - 5.5f, 2.3f);
            canvas.FillCircle(x + 1, y - 7.5f, 2.3f);
            canvas.FillCircle(x + 5.5f, y - 4.5f, 2.3f);
        }
        else
        {
            var outline = new PathF();
            outline.MoveTo(x - 10, y - 3);
            outline.LineTo(x + 10, y - 3);
            outline.LineTo(x + 7, y + 7);
            outline.LineTo(x - 7, y + 7);
            outline.Close();
            canvas.StrokeColor = color;
            canvas.StrokeSize = 2.5f;
            canvas.StrokeLineJoin = LineJoin.Round;
            canvas.DrawPath(outline);
        }
    }
}
