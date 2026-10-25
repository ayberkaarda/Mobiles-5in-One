using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using Patika.Domain.Entities;
using Patika.Web.Routing;
using Patika.Web.Seo;
using Patika.Web.Services;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages.BakimYeri;

[OutputCache(PolicyName = CachePolicies.Listing)]
public sealed class IndexModel(ICarePlaceQueries carePlaces, TimeProvider clock) : PublicPageModel(clock)
{
    public CarePlaceView Place { get; private set; } = null!;
    public OpeningHours.Result Hours { get; private set; } = null!;
    public IReadOnlyList<CarePlaceView> Nearby { get; private set; } = [];
    public string? Tel => PublicText.TelHref(Place.Phone);
    public string MapLink => "https://www.google.com/maps/search/?api=1&query=" + Uri.EscapeDataString(Place.Address);

    public string Lede
    {
        get
        {
            var where = Place.DistrictName is null ? "" : PublicText.In(Place.DistrictName) + " ";
            var open = Place.Open24h ? "24 saat açık " : "";
            var article = Place.Kind == CarePlaceKind.Vet ? "kliniğidir" : Place.Kind == CarePlaceKind.Shelter ? "barınağıdır" : "bakımevidir";
            var kind = Place.Kind switch
            {
                CarePlaceKind.Vet => "bir veteriner " + article,
                CarePlaceKind.Shelter => "bir hayvan " + article,
                _ => "bir belediye " + article
            };
            return $"{Place.Name}, {where}{open}{kind}. Yaralı bir sokak hayvanı getirmeden önce telefonla haber vermeni öneririz.";
        }
    }

    public async Task<IActionResult> OnGetAsync(string slug, CancellationToken ct)
    {
        if (await carePlaces.GetBySlugAsync(slug, ct) is not { } place) return NotFound();
        Place = place;
        Hours = OpeningHours.Parse(place.HoursJson, place.Open24h);
        // At most five others plus this place itself, read in SQL; a district with no other place falls back to 24 h places.
        IReadOnlyList<CarePlaceView> others = place.DistrictSlug is null ? [] : await carePlaces.ListAsync(districtSlug: place.DistrictSlug, limit: 6, ct: ct);
        if (others.Count <= 1) others = await carePlaces.ListAsync(open24h: true, limit: 6, ct: ct);
        Nearby = others.Where(p => p.Slug != place.Slug).OrderByDescending(p => p.Open24h).Take(5).ToArray();

        Crumbs = [new("Ana sayfa", Routes.Home), new("Bakım yerleri", Routes.CarePlaces), new(place.Name, Routes.CarePlace(place.Slug))];
        var description = PublicText.Description(
            $"{place.Name}: {(place.Open24h ? "24 saat açık " : "")}{PublicText.CareKindLong(place.Kind)}{(place.DistrictName is null ? "" : ", " + place.DistrictName)}. Adres, telefon ve çalışma saatleri; yaralı sokak hayvanları için.",
            PublicText.Filler);
        var schema = JsonLd.CarePlace(Urls, place);
        if (!place.Open24h && Hours.Schema.Count > 0) schema["openingHours"] = Hours.Schema;
        Seo(PublicText.Title($"{place.Name}{(place.DistrictName is null ? "" : ", " + place.DistrictName)}"), description,
            Routes.CarePlace(place.Slug), jsonLd: [schema, BreadcrumbList()]);
        return Page();
    }
}
