using System.Globalization;
using System.Text;

namespace Patika.Api.Features.Admin;

internal sealed record AdminCursor(DateTimeOffset At, Guid Id)
{
    public static string Encode(DateTimeOffset at, Guid id) => Convert.ToBase64String(Encoding.ASCII.GetBytes(
        $"{at.UtcTicks.ToString(CultureInfo.InvariantCulture)}:{id:D}"));

    public static bool TryParse(string? value, out AdminCursor? cursor)
    {
        cursor = null;
        if (value is null) return true;
        if (value.Length > 160) return false;
        try
        {
            var parts = Encoding.ASCII.GetString(Convert.FromBase64String(value)).Split(':');
            if (parts.Length != 2 || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
                || !Guid.TryParseExact(parts[1], "D", out var id) || ticks < 0 || ticks > DateTimeOffset.MaxValue.Ticks) return false;
            cursor = new AdminCursor(new DateTimeOffset(ticks, TimeSpan.Zero), id);
            return true;
        }
        catch (FormatException) { return false; }
    }
}
