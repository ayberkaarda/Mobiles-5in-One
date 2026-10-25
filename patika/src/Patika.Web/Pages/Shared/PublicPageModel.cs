using Microsoft.AspNetCore.Mvc.RazorPages;
using Patika.Web.Seo;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages;

/// <summary>One step of the "Ana sayfa / ..." trail; the last step has no link.</summary>
public sealed record Crumb(string Label, string? Href = null);

/// <summary>A collar tag needs the clock for its "N gün sonra kapanır" line.</summary>
public sealed record CollarTag(AdoptionCard Card, DateTimeOffset Now);

/// <summary>Shared plumbing for the public pages: head metadata, breadcrumbs and absolute URLs for JSON-LD.</summary>
public abstract class PublicPageModel(TimeProvider clock) : PageModel
{
    public DateTimeOffset Now { get; } = clock.GetUtcNow();

    public IReadOnlyList<Crumb> Crumbs { get; protected set; } = [];

    protected SiteUrls Urls => HttpContext.RequestServices.GetRequiredService<SiteUrls>();

    /// <summary>
    /// Hands the head metadata to the layout. The canonical path never carries a query string; filtered or
    /// paged views of a list point at the list itself and pass <paramref name="noIndex"/>.
    /// </summary>
    protected void Seo(string title, string description, string canonicalPath, bool noIndex = false,
        IReadOnlyList<object>? jsonLd = null, string? imagePath = null, string? imageAlt = null) =>
        ViewData[SeoMeta.Key] = new SeoMeta(title, description, canonicalPath)
        {
            NoIndex = noIndex,
            JsonLd = jsonLd ?? [],
            ImagePath = imagePath,
            ImageAlt = imageAlt
        };

    /// <summary>The visible trail as a BreadcrumbList; steps without a link are left out, except the page itself.</summary>
    protected object BreadcrumbList() => JsonLd.Breadcrumbs(Urls, Crumbs
        .Where((crumb, index) => crumb.Href is not null || index == Crumbs.Count - 1)
        .Select(crumb => (crumb.Label, crumb.Href ?? Request.Path.Value ?? "/")).ToArray());

    protected object ItemList(string name, IEnumerable<(string Name, string Path)> items) => new Dictionary<string, object>
    {
        ["@context"] = "https://schema.org",
        ["@type"] = "ItemList",
        ["name"] = name,
        ["itemListElement"] = items.Select((item, index) => new Dictionary<string, object>
        {
            ["@type"] = "ListItem",
            ["position"] = index + 1,
            ["name"] = item.Name,
            ["url"] = Urls.Absolute(item.Path)
        }).ToArray()
    };
}
