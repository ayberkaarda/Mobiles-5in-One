using Patika.Web.Routing;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages.Etki;

public sealed class IndexModel(IImpactQueries impact, TimeProvider clock) : PublicPageModel(clock)
{
    public ImpactSummary Summary { get; private set; } = null!;
    public ImpactWeek Last => Summary.LastWeek;

    public async Task OnGetAsync(CancellationToken ct)
    {
        Summary = await impact.GetAsync(ct);
        Crumbs = [new("Ana sayfa", Routes.Home), new("Etki", Routes.Impact)];
        var week = PublicText.Week(Last.StartsOn, withYear: true);
        var description = PublicText.Description(
            $"{week} haftasında Patika gönüllüleri {PublicText.Number(Last.Feedings)} besleme kaydetti, {PublicText.Number(Last.Adoptions)} hayvan yuvasına kavuştu. Son dört hafta ve yöntem.",
            PublicText.Filler);
        var first = Summary.Weeks[0].StartsOn;
        var dataset = new Dictionary<string, object>
        {
            ["@context"] = "https://schema.org",
            ["@type"] = "Dataset",
            ["name"] = "Patika haftalık etki sayıları",
            ["description"] = Summary.MethodNote,
            ["url"] = Urls.Absolute(Routes.Impact),
            ["inLanguage"] = "tr",
            ["isAccessibleForFree"] = true,
            ["temporalCoverage"] = $"{first:yyyy-MM-dd}/{Last.StartsOn.AddDays(6):yyyy-MM-dd}",
            ["variableMeasured"] = new[] { "Besleme", "Yeni istasyon", "Yuvaya kavuşan hayvan", "Kapanan acil çağrı" }
        };
        Seo(PublicText.Title("Etki: sokak hayvanları için geçen hafta"), description, Routes.Impact, jsonLd: [dataset, BreadcrumbList()]);
    }
}
