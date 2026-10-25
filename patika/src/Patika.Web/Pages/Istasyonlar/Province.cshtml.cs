using Microsoft.AspNetCore.Mvc;
using Patika.Web.Routing;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages.Istasyonlar;

public sealed class ProvinceModel(IPlaceQueries places, TimeProvider clock) : PublicPageModel(clock)
{
    public ProvinceDetail Province { get; private set; } = null!;
    public IReadOnlyList<DistrictListItem> Active { get; private set; } = [];
    public IReadOnlyList<DistrictListItem> Quiet { get; private set; } = [];

    public async Task<IActionResult> OnGetAsync(string il, CancellationToken ct)
    {
        if (await places.GetProvinceAsync(il, ct) is not { } province) return NotFound();
        Province = province;
        Active = province.Districts.Where(d => d.ActiveStations + d.OpenAdoptions > 0).ToArray();
        Quiet = province.Districts.Where(d => d.ActiveStations + d.OpenAdoptions == 0).ToArray();
        var stations = Active.Sum(d => d.ActiveStations);

        Crumbs = [new("Ana sayfa", Routes.Home), new("İstasyonlar"), new(province.Name, Routes.Province(province.Slug))];
        var description = PublicText.Description(
            $"{PublicText.In(province.Name)} {Active.Count} ilçede {PublicText.Number(stations)} mama ve su istasyonu. İlçeni seç; son besleme zamanlarını, bakım yerlerini ve sahiplendirme ilanlarını gör.",
            PublicText.Filler);
        Seo(PublicText.Title($"{PublicText.In(province.Name)} ilçe ilçe sokak hayvanı istasyonları"), description,
            Routes.Province(province.Slug), noIndex: Active.Count == 0, jsonLd:
            [ItemList($"{province.Name} ilçeleri", Active.Select(d => (d.Name, Routes.District(province.Slug, d.Slug)))), BreadcrumbList()]);
        return Page();
    }
}
