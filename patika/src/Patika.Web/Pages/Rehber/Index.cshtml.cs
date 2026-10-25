using Microsoft.AspNetCore.Mvc.RazorPages;
using Patika.Web.Routing;
using Patika.Web.Seo;
using Patika.Web.Seo.Documents;

namespace Patika.Web.Pages.Rehber;

public sealed class IndexModel(DocumentStore documents, SiteUrls urls) : PageModel
{
    public IReadOnlyList<ContentDoc> Guides { get; private set; } = [];

    public void OnGet()
    {
        Guides = documents.List("rehber");
        ViewData[SeoMeta.Key] = new SeoMeta(
            "Rehber: sokak hayvanlarına nasıl yardım edilir? | Patika",
            "Sokak kedilerini ve köpeklerini güvenle beslemek, yaralı hayvana yardım, sahiplenme, mevsim bakımı ve kısırlaştırma üzerine kısa, uygulanabilir rehberler.",
            Routes.Guides)
        {
            JsonLd = [JsonLd.Breadcrumbs(urls, ("Ana sayfa", Routes.Home), ("Rehber", Routes.Guides))],
        };
    }
}
