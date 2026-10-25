using System.Globalization;

namespace Patika.Web.Seo.Documents;

/// <summary>"20 Ekim 2026" without relying on ICU culture data in the container.</summary>
public static class TurkishDate
{
    private static readonly string[] Months =
        ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

    public static string Format(DateOnly date) => $"{date.Day} {Months[date.Month - 1]} {date.Year}";

    public static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
