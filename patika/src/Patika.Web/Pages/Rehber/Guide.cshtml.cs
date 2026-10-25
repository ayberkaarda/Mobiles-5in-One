using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Patika.Web.Routing;
using Patika.Web.Seo;
using Patika.Web.Seo.Documents;

namespace Patika.Web.Pages.Rehber;

public sealed class GuideModel(DocumentStore documents, SiteUrls urls) : PageModel
{
    public ContentDoc Guide { get; private set; } = null!;

    public IReadOnlyList<ContentDoc> Others { get; private set; } = [];

    public IActionResult OnGet(string slug)
    {
        if (documents.Find("rehber", slug) is not { } guide) return NotFound();
        Guide = guide;
        Others = documents.List("rehber").Where(g => g.Slug != guide.Slug).ToArray();
        var path = Routes.Guide(guide.Slug);
        var jsonLd = new List<object>
        {
            JsonLd.Article(urls, path, guide.Title, guide.Description, guide.Published, guide.Updated),
            JsonLd.Breadcrumbs(urls, ("Ana sayfa", Routes.Home), ("Rehber", Routes.Guides), (guide.ShortTitle ?? guide.Title, path)),
        };
        if (guide.Faq.Count > 0) jsonLd.Add(JsonLd.FaqPage(guide.Faq.Select(f => (f.Question, MarkdownLite.PlainText(f.Answer)))));
        ViewData[SeoMeta.Key] = new SeoMeta(guide.Title + " | Patika rehber", guide.Description, path)
        {
            OgType = "article",
            JsonLd = jsonLd,
        };
        return Page();
    }
}
