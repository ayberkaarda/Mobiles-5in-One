using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;
using Patika.Domain.Entities;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Seo;

/// <summary>Schema.org objects for JSON-LD, and the only serializer allowed to write them into a page.</summary>
public static class JsonLd
{
    private static readonly JsonSerializerOptions Options = new()
    {
        // Keeps Turkish letters readable; the encoder still escapes &lt; &gt; &amp; and quotes.
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        WriteIndented = false,
    };

    /// <summary>
    /// JSON safe to place inside a script element: no raw &lt; can survive, so user text cannot close the
    /// element (&lt;/script&gt;) or open a comment. '&lt;' is only legal inside JSON strings, where < is equal.
    /// </summary>
    public static string Serialize(object item) =>
        JsonSerializer.Serialize(item, item.GetType(), Options).Replace("<", "\u003c", StringComparison.Ordinal);

    public static Dictionary<string, object?> Organization(SiteUrls urls) => new()
    {
        ["@context"] = "https://schema.org",
        ["@type"] = "Organization",
        ["@id"] = urls.Absolute("/") + "#organization",
        ["name"] = "Patika",
        ["url"] = urls.Absolute("/"),
        ["logo"] = urls.Absolute("/img/patika-icon-192.png"),
    };

    public static Dictionary<string, object?> WebSite(SiteUrls urls) => new()
    {
        ["@context"] = "https://schema.org",
        ["@type"] = "WebSite",
        ["@id"] = urls.Absolute("/") + "#website",
        ["name"] = "Patika",
        ["url"] = urls.Absolute("/"),
        ["inLanguage"] = "tr-TR",
        ["publisher"] = new Dictionary<string, object?> { ["@id"] = urls.Absolute("/") + "#organization" },
    };

    public static Dictionary<string, object?> Breadcrumbs(SiteUrls urls, params (string Name, string Path)[] items) => new()
    {
        ["@context"] = "https://schema.org",
        ["@type"] = "BreadcrumbList",
        ["itemListElement"] = items.Select((item, index) => new Dictionary<string, object?>
        {
            ["@type"] = "ListItem",
            ["position"] = index + 1,
            ["name"] = item.Name,
            ["item"] = urls.Absolute(item.Path),
        }).ToArray(),
    };

    public static Dictionary<string, object?> Article(SiteUrls urls, string path, string headline, string description,
        DateOnly published, DateOnly modified) => new()
        {
            ["@context"] = "https://schema.org",
            ["@type"] = "Article",
            ["headline"] = headline,
            ["description"] = description,
            ["inLanguage"] = "tr-TR",
            ["datePublished"] = published.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            ["dateModified"] = modified.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            ["mainEntityOfPage"] = urls.Absolute(path),
            ["url"] = urls.Absolute(path),
            ["image"] = urls.Absolute(SiteUrls.DefaultOgImage),
            ["author"] = new Dictionary<string, object?> { ["@type"] = "Organization", ["name"] = "Patika", ["url"] = urls.Absolute("/") },
            ["publisher"] = new Dictionary<string, object?>
            {
                ["@type"] = "Organization",
                ["name"] = "Patika",
                ["logo"] = new Dictionary<string, object?> { ["@type"] = "ImageObject", ["url"] = urls.Absolute("/img/patika-icon-192.png") },
            },
        };

    public static Dictionary<string, object?> FaqPage(IEnumerable<(string Question, string Answer)> items) => new()
    {
        ["@context"] = "https://schema.org",
        ["@type"] = "FAQPage",
        ["mainEntity"] = items.Select(item => new Dictionary<string, object?>
        {
            ["@type"] = "Question",
            ["name"] = item.Question,
            ["acceptedAnswer"] = new Dictionary<string, object?> { ["@type"] = "Answer", ["text"] = item.Answer },
        }).ToArray(),
    };

    /// <summary>A care place as VeterinaryCare or AnimalShelter, for the care place detail page.</summary>
    public static Dictionary<string, object?> CarePlace(SiteUrls urls, CarePlaceView place)
    {
        var item = new Dictionary<string, object?>
        {
            ["@context"] = "https://schema.org",
            ["@type"] = place.Kind == CarePlaceKind.Vet ? "VeterinaryCare" : "AnimalShelter",
            ["name"] = place.Name,
            ["url"] = urls.Absolute(Routing.Routes.CarePlace(place.Slug)),
            ["address"] = new Dictionary<string, object?>
            {
                ["@type"] = "PostalAddress",
                ["streetAddress"] = place.Address,
                ["addressLocality"] = place.DistrictName,
                ["addressCountry"] = "TR",
            },
        };
        // Only the seeded İstanbul districts carry a slug; an unlinked place gets no region rather than a guess.
        if (place.DistrictSlug is not null) ((Dictionary<string, object?>)item["address"]!)["addressRegion"] = "İstanbul";
        if (place.DistrictName is null) ((Dictionary<string, object?>)item["address"]!).Remove("addressLocality");
        if (!string.IsNullOrWhiteSpace(place.Phone)) item["telephone"] = place.Phone;
        if (!string.IsNullOrWhiteSpace(place.Website)) item["sameAs"] = place.Website;
        if (place.Open24h)
        {
            item["openingHoursSpecification"] = new Dictionary<string, object?>
            {
                ["@type"] = "OpeningHoursSpecification",
                ["dayOfWeek"] = new[] { "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" },
                ["opens"] = "00:00",
                ["closes"] = "23:59",
            };
        }
        return item;
    }
}
