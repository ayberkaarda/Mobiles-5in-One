namespace Patika.Web.Seo;

/// <summary>
/// Head metadata a page hands to the layout through <c>ViewData[SeoMeta.Key]</c>. Pages fill it;
/// <c>Pages/Shared/_SeoHead.cshtml</c> renders it (title, description, canonical, robots, Open Graph, JSON-LD).
/// </summary>
public sealed record SeoMeta(string Title, string Description, string CanonicalPath)
{
    public const string Key = "Seo";

    /// <summary>Absolute or site-relative Open Graph image; null uses the site default.</summary>
    public string? ImagePath { get; init; }

    /// <summary>True for pages that must not be indexed (admin, errors, thin results).</summary>
    public bool NoIndex { get; init; }

    /// <summary>Schema.org objects, serialized as one JSON-LD script each.</summary>
    public IReadOnlyList<object> JsonLd { get; init; } = [];

    /// <summary>Open Graph type: "website" by default, "article" for guides.</summary>
    public string OgType { get; init; } = "website";

    /// <summary>Alt text for the Open Graph image; null uses the default image's description.</summary>
    public string? ImageAlt { get; init; }
}
