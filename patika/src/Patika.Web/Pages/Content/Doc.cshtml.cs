using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Patika.Web.Routing;
using Patika.Web.Seo;
using Patika.Web.Seo.Documents;

namespace Patika.Web.Pages.Content;

/// <summary>/hakkinda, /sss and /iletisim from <c>Content/sayfa/*.md</c>; /sss also emits FAQPage JSON-LD.</summary>
public sealed class DocModel(DocumentStore documents, SiteUrls urls) : PageModel
{
    public ContentDoc Doc { get; private set; } = null!;

    public IActionResult OnGet(string doc)
    {
        if (documents.Find("sayfa", doc) is not { } found) return NotFound();
        Doc = found;
        var path = "/" + found.Slug;
        var jsonLd = new List<object> { JsonLd.Breadcrumbs(urls, ("Ana sayfa", Routes.Home), (found.ShortTitle ?? found.Title, path)) };
        if (found.Faq.Count > 0) jsonLd.Add(JsonLd.FaqPage(found.Faq.Select(f => (f.Question, MarkdownLite.PlainText(f.Answer)))));
        ViewData[SeoMeta.Key] = new SeoMeta(found.Title + " | Patika", found.Description, path) { JsonLd = jsonLd };
        return Page();
    }
}
