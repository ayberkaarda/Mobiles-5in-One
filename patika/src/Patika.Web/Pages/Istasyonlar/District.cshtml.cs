using Microsoft.AspNetCore.Mvc;
using Patika.Web.Routing;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages.Istasyonlar;

public sealed class DistrictModel(IPlaceQueries places, TimeProvider clock) : PublicPageModel(clock)
{
    public DistrictSummary District { get; private set; } = null!;
    public int NeedsRefill => District.Stations.Count(s => s.NeedsRefill);

    public async Task<IActionResult> OnGetAsync(string il, string ilce, CancellationToken ct)
    {
        if (await places.GetDistrictAsync(il, ilce, ct) is not { } district) return NotFound();
        District = district;

        Crumbs = [new("Ana sayfa", Routes.Home), new("İstasyonlar"), new(district.ProvinceName, Routes.Province(district.ProvinceSlug)),
            new(district.Name, Routes.District(district.ProvinceSlug, district.Slug))];
        var where = PublicText.In(district.Name);
        var description = district.ActiveStations > 0
            ? $"{where} {PublicText.Number(district.ActiveStations)} mama ve su istasyonu, son 7 günde {PublicText.Number(district.FeedingsLastSevenDays)} besleme. Son besleme zamanları, bakım yerleri ve {PublicText.Number(district.OpenAdoptions)} sahiplendirme ilanı."
            : $"{where} henüz kayıtlı mama ve su istasyonu yok. İlçedeki bakım yerleri, {PublicText.Number(district.OpenAdoptions)} sahiplendirme ilanı ve ilk istasyonu ekleme yolu.";
        var thin = district.ActiveStations == 0 && district.OpenAdoptions == 0;
        Seo(PublicText.Title($"{where} sokak hayvanı istasyonları"), PublicText.Description(description, PublicText.Filler),
            Routes.District(district.ProvinceSlug, district.Slug), noIndex: thin, jsonLd: [BreadcrumbList()]);
        return Page();
    }
}
