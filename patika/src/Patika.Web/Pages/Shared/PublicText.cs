using System.Globalization;
using System.Text;
using Patika.Domain.Entities;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages;

/// <summary>
/// Turkish wording for the public pages. Formatting is spelled out here instead of relying on the
/// tr-TR culture data, so the output is the same on every host.
/// </summary>
public static class PublicText
{
    private static readonly string[] Months =
        ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

    private static readonly NumberFormatInfo Numbers = new() { NumberGroupSeparator = ".", NumberDecimalSeparator = "," };

    public const string Brand = " | Patika";

    public static readonly TimeZoneInfo Istanbul = TimeZoneInfo.FindSystemTimeZoneById("Europe/Istanbul");

    /// <summary>1284 → "1.284".</summary>
    public static string Number(long value) => value.ToString("#,0", Numbers);

    /// <summary>"16 Aralık 2026" in Istanbul time.</summary>
    public static string Date(DateTimeOffset value)
    {
        var local = TimeZoneInfo.ConvertTime(value, Istanbul);
        return $"{local.Day} {Months[local.Month - 1]} {local.Year}";
    }

    /// <summary>A Monday-to-Sunday week: "19–25 Ekim", "28 Eylül–4 Ekim", "29 Aralık 2025–4 Ocak 2026".</summary>
    public static string Week(DateOnly monday, bool withYear = false)
    {
        var sunday = monday.AddDays(6);
        var end = $"{sunday.Day} {Months[sunday.Month - 1]}" + (withYear ? $" {sunday.Year}" : "");
        if (monday.Year != sunday.Year) return $"{monday.Day} {Months[monday.Month - 1]} {monday.Year}–{sunday.Day} {Months[sunday.Month - 1]} {sunday.Year}";
        return monday.Month == sunday.Month ? $"{monday.Day}–{end}" : $"{monday.Day} {Months[monday.Month - 1]}–{end}";
    }

    /// <summary>
    /// Locative case with the apostrophe used for proper names: "Kadıköy’de", "Üsküdar’da", "Beşiktaş’ta".
    /// </summary>
    public static string In(string name)
    {
        var word = name.Trim();
        var lower = word.Replace('I', 'ı').Replace('İ', 'i').ToLowerInvariant();
        var vowel = 'a';
        for (var i = lower.Length - 1; i >= 0; i--)
        {
            if ("aıou".Contains(lower[i], StringComparison.Ordinal)) { vowel = 'a'; break; }
            if ("eiöü".Contains(lower[i], StringComparison.Ordinal)) { vowel = 'e'; break; }
        }
        var last = lower.Length > 0 ? lower[^1] : 'a';
        var consonant = "fstkçşhp".Contains(last, StringComparison.Ordinal) ? 't' : 'd';
        return $"{word}’{consonant}{vowel}";
    }

    /// <summary>"Kadıköy’deki".</summary>
    public static string InRelative(string name) => In(name) + "ki";

    public static string Species(Species species) => species switch
    {
        Domain.Entities.Species.Cat => "Kedi",
        Domain.Entities.Species.Dog => "Köpek",
        _ => "Karışık"
    };

    public static string SpeciesLower(Species species) => species switch
    {
        Domain.Entities.Species.Cat => "kedi",
        Domain.Entities.Species.Dog => "köpek",
        _ => "hayvan"
    };

    public static string Sex(AnimalSex sex) => sex switch
    {
        AnimalSex.Female => "Dişi",
        AnimalSex.Male => "Erkek",
        _ => "Cinsiyeti bilinmiyor"
    };

    public static string AnimalName(AdoptionCard card) =>
        string.IsNullOrWhiteSpace(card.AnimalName) ? $"İsimsiz {SpeciesLower(card.Species)}" : card.AnimalName.Trim();

    /// <summary>"Dişi, kısırlaştırılmış" / "Erkek" / "Cinsiyeti bilinmiyor".</summary>
    public static string SexLine(AdoptionCard card) =>
        card.Sterilized ? $"{Sex(card.Sex)}, kısırlaştırılmış" : Sex(card.Sex);

    /// <summary>"Aşılı, kulak küpeli" / "Aşılı, kısırlaştırılmadı" / "Aşı bekliyor".</summary>
    public static string HealthLine(AdoptionCard card)
    {
        var parts = new List<string> { card.Vaccinated ? "Aşılı" : "Aşı bekliyor" };
        if (card.EarTagged) parts.Add("kulak küpeli");
        if (!card.Sterilized && card.Vaccinated) parts.Add("kısırlaştırılmadı");
        return string.Join(", ", parts);
    }

    public static bool HealthIsGood(AdoptionCard card) => card.Vaccinated && card.Sterilized;

    public static string? Age(short? birthYear, DateTimeOffset now)
    {
        if (birthYear is null) return null;
        var years = TimeZoneInfo.ConvertTime(now, Istanbul).Year - birthYear.Value;
        return years switch
        {
            < 0 => null,
            0 => "bu yıl doğmuş",
            _ => $"yaklaşık {years} yaşında"
        };
    }

    public static string ClosesIn(DateTimeOffset closesAt, DateTimeOffset now)
    {
        var days = (int)Math.Ceiling((closesAt - now).TotalDays);
        return days <= 1 ? "Bugün kapanır" : $"{days} gün sonra kapanır";
    }

    public static string StationKind(StationKind kind) => kind switch
    {
        Domain.Entities.StationKind.Food => "Mama",
        Domain.Entities.StationKind.Water => "Su",
        _ => "Mama ve su"
    };

    public static string LastFed(LastFedBucket bucket) => bucket switch
    {
        LastFedBucket.Today => "Bugün",
        LastFedBucket.ThisWeek => "Bu hafta",
        LastFedBucket.Older => "Bu haftadan önce",
        _ => "Henüz kayıt yok"
    };

    public static string CareKind(CarePlaceKind kind) => kind switch
    {
        CarePlaceKind.Vet => "Veteriner",
        CarePlaceKind.Shelter => "Barınak",
        _ => "Belediye bakımevi"
    };

    public static string CareKindLong(CarePlaceKind kind) => kind switch
    {
        CarePlaceKind.Vet => "veteriner kliniği",
        CarePlaceKind.Shelter => "hayvan barınağı",
        _ => "belediye bakımevi"
    };

    /// <summary>"tel:+902160000000" for a Turkish number written any common way; null when it has no digits.</summary>
    public static string? TelHref(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return null;
        var digits = new StringBuilder();
        foreach (var c in phone) if (char.IsAsciiDigit(c)) digits.Append(c);
        var d = digits.ToString();
        if (d.Length == 0) return null;
        if (d.StartsWith("90", StringComparison.Ordinal) && d.Length == 12) return "tel:+" + d;
        if (d.StartsWith('0') && d.Length == 11) return "tel:+90" + d[1..];
        if (d.Length == 10) return "tel:+90" + d;
        return "tel:" + (phone.TrimStart().StartsWith('+') ? "+" : "") + d;
    }

    /// <summary>Upper-cases the first letter the Turkish way (i → İ).</summary>
    public static string Capitalize(string text) => text.Length == 0 ? text
        : (text[0] == 'i' ? "İ" : char.ToUpperInvariant(text[0]).ToString()) + text[1..];

    /// <summary>Page title with the brand when it fits in 60 characters.</summary>
    public static string Title(string core)
    {
        core = core.Trim();
        if (core.Length + Brand.Length <= 60) return core + Brand;
        return core.Length <= 60 ? core : core[..59].TrimEnd() + "…";
    }

    /// <summary>
    /// Meta description between 120 and 160 characters: pads a short text with <paramref name="filler"/>
    /// and cuts a long one at a word boundary.
    /// </summary>
    public static string Description(string text, string filler)
    {
        text = text.Trim();
        if (text.Length < 120) text = text + " " + filler.Trim();
        if (text.Length < 120) text += " Mahallenin patilerini birlikte koruyalım.";
        if (text.Length <= 160) return text;
        var cut = text[..159];
        var space = cut.LastIndexOf(' ');
        if (space >= 120) cut = cut[..space];
        return cut.TrimEnd(',', ';', ' ', '.') + "…";
    }

    public const string Filler = "Patika, sokak kedileri ve köpekleri için mahalle gönüllülerini buluşturan ücretsiz bir uygulamadır.";
}
