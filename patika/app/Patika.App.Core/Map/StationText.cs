using System.Globalization;
using Patika.Contracts.Community;

namespace Patika.App.Core.Map;

/// <summary>Turkish wording for stations and feedings, as on the canvas ("Bugün 07.40’ta beslendi").</summary>
public static class StationText
{
    public static readonly CultureInfo Turkish = CultureInfo.GetCultureInfo("tr-TR");

    public static string Kind(string kind) => kind switch { "Water" => "su", "Both" => "mama ve su", _ => "mama" };

    public static string KindChip(string kind) => kind switch { "Water" => "Su", "Both" => "Mama ve su", _ => "Mama" };

    public static string Species(string species) => species switch { "Dog" => "Köpek", "Mixed" => "Kedi ve köpek", _ => "Kedi" };

    /// <summary>"Kedi istasyonu, mama ve su. 312 besleme kaydı."</summary>
    public static string Summary(StationResponse station) =>
        string.Create(Turkish, $"{Species(station.Species)} istasyonu, {Kind(station.Kind)}. {station.FeedingsCount} besleme kaydı.");

    public static string Clock(DateTimeOffset at, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTime(at, zone).ToString("HH.mm", Turkish);

    public static bool IsToday(DateTimeOffset? at, DateTimeOffset now, TimeZoneInfo zone) =>
        at is { } value && TimeZoneInfo.ConvertTime(value, zone).Date == TimeZoneInfo.ConvertTime(now, zone).Date;

    /// <summary>"Bugün 07.40’ta beslendi", "Dün 19.15’te beslendi", "3 Eki’de beslendi" or "Henüz beslenmedi".</summary>
    public static string LastFed(DateTimeOffset? at, DateTimeOffset now, TimeZoneInfo zone)
    {
        if (at is not { } value)
        {
            return "Henüz beslenmedi";
        }

        var local = TimeZoneInfo.ConvertTime(value, zone);
        var today = TimeZoneInfo.ConvertTime(now, zone).Date;
        var clock = local.ToString("HH.mm", Turkish);
        if (local.Date == today)
        {
            return $"Bugün {clock}’{Locative(local)} beslendi";
        }

        if (local.Date == today.AddDays(-1))
        {
            return $"Dün {clock}’{Locative(local)} beslendi";
        }

        return $"{local.ToString("d MMMM", Turkish)} günü beslendi";
    }

    /// <summary>The left column of a feeding row: "07.40" today, else "Dün" or "3 Eki".</summary>
    public static string FeedingDay(DateTimeOffset at, DateTimeOffset now, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTime(at, zone);
        var today = TimeZoneInfo.ConvertTime(now, zone).Date;
        if (local.Date == today)
        {
            return local.ToString("HH.mm", Turkish);
        }

        return local.Date == today.AddDays(-1) ? "Dün" : local.ToString("d MMM", Turkish);
    }

    /// <summary>"Sen" for the caller's own record, else the display name the API sends.</summary>
    public static string Author(FeedingResponse feeding) => feeding.IsMine ? "Sen" : feeding.AuthorDisplayName;

    /// <summary>The locative suffix after a clock time read aloud: 07.40 (kırk) ’ta, 08.22 (iki) ’de, 09.00 (dokuz) ’da.</summary>
    public static string Locative(DateTimeOffset time) => Suffix(time, "da", "de", "ta", "te");

    /// <summary>The ablative suffix: "08.22’den sonra", "07.40’tan sonra".</summary>
    public static string Ablative(DateTimeOffset time) => Suffix(time, "dan", "den", "tan", "ten");

    private static string Suffix(DateTimeOffset time, string back, string front, string backHard, string frontHard)
    {
        var spoken = time.Minute != 0 ? time.Minute : time.Hour;
        var (isFront, isHard) = LastWord(spoken);
        return (isFront, isHard) switch
        {
            (true, true) => frontHard,
            (true, false) => front,
            (false, true) => backHard,
            _ => back,
        };
    }

    /// <summary>Vowel harmony and consonant hardening of the last word of a number from 0 to 59.</summary>
    private static (bool Front, bool Hard) LastWord(int number)
    {
        var ones = number % 10;
        if (ones != 0)
        {
            // bir iki üç dört beş altı yedi sekiz dokuz
            return ones switch
            {
                1 or 2 or 7 or 8 => (true, false),
                3 or 4 or 5 => (true, true),
                _ => (false, false), // altı, dokuz
            };
        }

        return (number / 10) switch
        {
            0 => (false, false), // sıfır
            1 => (false, false), // on
            2 => (true, false), // yirmi
            3 => (false, false), // otuz
            4 => (false, true), // kırk
            _ => (true, false), // elli
        };
    }
}
