using System.Text.Json;
using System.Text.RegularExpressions;

namespace Patika.Web.Pages.BakimYeri;

/// <summary>
/// Reads a care place's hours. <c>HoursJson</c> has no fixed schema yet, so this accepts the obvious shape,
/// <c>{"mon": "09:00-18:00", "sat": ["10:00-13:00", "14:00-17:00"], "sun": "closed"}</c>: keys are two or
/// three letters or full English day names; a value is one range, a list of ranges, or the word
/// <c>"closed"</c> (or <c>"kapali"</c>, any case), which is the only way to say a day is closed. A day that
/// is missing or has no readable range is unknown ("Bilinmiyor"), never closed, so nobody is turned away
/// from a place that may be open. Anything that is not a JSON object returns no lines at all.
/// </summary>
public static class OpeningHours
{
    private static readonly (string Schema, string Turkish, string[] Keys)[] Days =
    [
        ("Mo", "Pazartesi", ["mo", "mon", "monday"]),
        ("Tu", "Salı", ["tu", "tue", "tuesday"]),
        ("We", "Çarşamba", ["we", "wed", "wednesday"]),
        ("Th", "Perşembe", ["th", "thu", "thursday"]),
        ("Fr", "Cuma", ["fr", "fri", "friday"]),
        ("Sa", "Cumartesi", ["sa", "sat", "saturday"]),
        ("Su", "Pazar", ["su", "sun", "sunday"])
    ];

    public sealed record Line(string Days, string Hours);

    public sealed record Result(IReadOnlyList<Line> Lines, IReadOnlyList<string> Schema);

    private const string Closed = "closed";

    public static Result Parse(string? json, bool open24h)
    {
        if (open24h) return new([new("Her gün", "24 saat")], ["Mo-Su 00:00-23:59"]);
        var perDay = new string?[7];
        try
        {
            using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return Empty;
            foreach (var property in document.RootElement.EnumerateObject())
            {
                var index = Array.FindIndex(Days, d => d.Keys.Contains(property.Name.Trim().ToLowerInvariant()));
                if (index < 0) continue;
                var ranges = property.Value.ValueKind switch
                {
                    JsonValueKind.String => [property.Value.GetString() ?? ""],
                    JsonValueKind.Array => property.Value.EnumerateArray().Where(v => v.ValueKind == JsonValueKind.String).Select(v => v.GetString() ?? "").ToArray(),
                    _ => Array.Empty<string>()
                };
                if (ranges.Length == 1 && ranges[0].Trim().ToLowerInvariant() is "closed" or "kapali" or "kapalı")
                {
                    perDay[index] = Closed;
                    continue;
                }
                var valid = ranges.Select(Normalize).OfType<string>().ToArray();
                perDay[index] = valid.Length == 0 ? null : string.Join(",", valid);
            }
        }
        catch (JsonException)
        {
            return Empty;
        }
        if (perDay.All(h => h is null)) return Empty;

        var lines = new List<Line>();
        var schema = new List<string>();
        for (var start = 0; start < 7;)
        {
            var end = start;
            while (end + 1 < 7 && perDay[end + 1] == perDay[start]) end++;
            var days = start == end ? Days[start].Turkish : $"{Days[start].Turkish}–{Days[end].Turkish}";
            lines.Add(new(days, perDay[start] switch
            {
                null => "Bilinmiyor",
                Closed => "Kapalı",
                var open => open.Replace(",", ", ", StringComparison.Ordinal).Replace("-", "–", StringComparison.Ordinal)
            }));
            if (perDay[start] is { } hours && hours != Closed)
            {
                var span = start == end ? Days[start].Schema : $"{Days[start].Schema}-{Days[end].Schema}";
                schema.AddRange(hours.Split(',').Select(h => $"{span} {h}"));
            }
            start = end + 1;
        }
        return new(lines, schema);
    }

    private static readonly Result Empty = new([], []);

    private static string? Normalize(string range)
    {
        var match = Range.Match(range.Trim());
        if (!match.Success || (match.Groups[3].Value == "24" && match.Groups[4].Value != "00")) return null;
        var from = new TimeOnly(int.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture), int.Parse(match.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture));
        var to = match.Groups[3].Value == "24" && match.Groups[4].Value == "00"
            ? new TimeOnly(23, 59)
            : new TimeOnly(int.Parse(match.Groups[3].Value, System.Globalization.CultureInfo.InvariantCulture), int.Parse(match.Groups[4].Value, System.Globalization.CultureInfo.InvariantCulture));
        return $"{from:HH\\:mm}-{to:HH\\:mm}";
    }

    private static readonly Regex Range = new(@"^([01]?\d|2[0-3])[:.]([0-5]\d)\s*[-–]\s*([01]?\d|2[0-4])[:.]([0-5]\d)$", RegexOptions.Compiled);
}
