using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using Patika.Domain.Entities;
using Patika.Web.Routing;
using Patika.Web.Services;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages.BakimYerleri;

[OutputCache(PolicyName = CachePolicies.Listing)]
public sealed class IndexModel(ICarePlaceQueries carePlaces, IPlaceQueries places, TimeProvider clock) : PublicPageModel(clock)
{
    public static readonly (string Value, CarePlaceKind Kind, string Label)[] Kinds =
    [
        ("veteriner", CarePlaceKind.Vet, "Veteriner"),
        ("barinak", CarePlaceKind.Shelter, "Barınak"),
        ("belediye", CarePlaceKind.MunicipalCare, "Belediye bakımevi")
    ];

    [FromQuery(Name = "tur")] public string? Kind { get; set; }
    [FromQuery(Name = "acik24")] public string? Open24 { get; set; }

    public CarePlaceKind? SelectedKind { get; private set; }
    public bool Only24h { get; private set; }
    public string? Province { get; private set; }
    public IReadOnlyList<CarePlaceView> Places { get; private set; } = [];

    public async Task<IActionResult> OnGetAsync(CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(Kind))
        {
            var match = Array.FindIndex(Kinds, k => k.Value == Kind);
            if (match < 0) return NotFound();
            SelectedKind = Kinds[match].Kind;
        }
        if (Open24 is not (null or "" or "1")) return NotFound();
        Only24h = Open24 == "1";
        Places = await carePlaces.ListAsync(SelectedKind, Only24h ? true : null, ct: ct);
        var provinces = await places.ListProvincesAsync(ct);
        Province = provinces.Count == 1 ? provinces[0].Name : null;

        Crumbs = Province is null
            ? [new("Ana sayfa", Routes.Home), new("Bakım yerleri", Routes.CarePlaces)]
            : [new("Ana sayfa", Routes.Home), new("Bakım yerleri", Routes.CarePlaces), new(Province, Routes.CarePlaces)];
        var where = Province is null ? "" : PublicText.In(Province) + " ";
        var what = SelectedKind switch
        {
            CarePlaceKind.Vet => "veteriner klinikleri",
            CarePlaceKind.Shelter => "hayvan barınakları",
            CarePlaceKind.MunicipalCare => "belediye bakımevleri",
            _ => "veteriner ve bakımevleri"
        };
        var title = PublicText.Capitalize($"{where}{(Only24h ? "24 saat açık " : "")}{what}");
        var description = PublicText.Description(
            $"{PublicText.Capitalize(where)}{PublicText.Number(Places.Count)} {(Only24h ? "24 saat açık " : "")}{what}: adres, telefon ve çalışma saatleri. Yaralı ya da hasta bir sokak hayvanı için en yakın yeri bul.",
            PublicText.Filler);
        Seo(PublicText.Title(title), description, Routes.CarePlaces, noIndex: Places.Count == 0 || SelectedKind is not null || Only24h,
            jsonLd: [ItemList(title, Places.Select(p => (p.Name, Routes.CarePlace(p.Slug)))), BreadcrumbList()]);
        return Page();
    }

    public string Link(string? kind, bool only24h)
    {
        var query = new List<string>();
        if (!string.IsNullOrEmpty(kind)) query.Add("tur=" + Uri.EscapeDataString(kind));
        if (only24h) query.Add("acik24=1");
        return query.Count == 0 ? Routes.CarePlaces : Routes.CarePlaces + "?" + string.Join("&", query);
    }
}
