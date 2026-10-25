using Microsoft.AspNetCore.Mvc.RazorPages;
using Patika.Web.Routing;
using Patika.Web.Seo;

namespace Patika.Web.Pages.Legal;

/// <summary>
/// Account deletion: the in-app path and the 7-day grace period (AccountEndpoints.DeletionGracePeriod).
/// There is no web deletion API yet, so the page offers the support e-mail route and no form.
/// </summary>
public sealed class HesapSilmeModel(SiteUrls urls) : PageModel
{
    public void OnGet() =>
        ViewData[SeoMeta.Key] = new SeoMeta(
            "Patika hesabını sil | Patika",
            "Patika hesabını uygulamadan nasıl silersin, 7 günlük vazgeçme süresi nasıl işler, uygulaman yoksa ne yapmalısın.",
            Routes.DeleteAccount)
        {
            JsonLd = [JsonLd.Breadcrumbs(urls, ("Ana sayfa", Routes.Home), ("Hesap silme", Routes.DeleteAccount))],
        };
}
