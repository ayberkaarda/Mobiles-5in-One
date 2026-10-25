using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Patika.Web.Routing;
using Patika.Web.Seo;
using Patika.Web.Seo.Documents;

namespace Patika.Web.Pages.Legal;

/// <summary>/gizlilik, /kvkk and /kosullar from <c>Content/yasal/*.md</c>. Drafts until legal review.</summary>
public sealed class DocModel(DocumentStore documents, SiteUrls urls) : PageModel
{
    public ContentDoc Doc { get; private set; } = null!;

    public IActionResult OnGet(string doc)
    {
        if (documents.Find("yasal", doc) is not { } found) return NotFound();
        Doc = found;
        var path = "/" + found.Slug;
        ViewData[SeoMeta.Key] = new SeoMeta(found.Title + " | Patika", found.Description, path)
        {
            JsonLd = [JsonLd.Breadcrumbs(urls, ("Ana sayfa", Routes.Home), (found.ShortTitle ?? found.Title, path))],
        };
        return Page();
    }
}
