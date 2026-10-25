using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using Patika.Domain.Entities;
using Patika.Web.Routing;
using Patika.Web.Services;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages.Sahiplendirme;

[OutputCache(PolicyName = CachePolicies.Listing)]
public sealed class IndexModel(IAdoptionQueries adoptions, IPlaceQueries places, TimeProvider clock) : PublicPageModel(clock)
{
    public const int PageSize = 12;

    [FromQuery(Name = "ilce")] public string? District { get; set; }
    [FromQuery(Name = "tur")] public string? Kind { get; set; }
    /// <summary>Read as text so "abc", "0", "-1", "007" or an overflowing number is a 404, not a silent page one.</summary>
    [FromQuery(Name = "sayfa")] public string? PageText { get; set; }

    public IReadOnlyList<DistrictListItem> Districts { get; private set; } = [];
    public DistrictListItem? SelectedDistrict { get; private set; }
    public IReadOnlyList<AdoptionCard> Cards { get; private set; } = [];
    public int Total { get; private set; }
    public int CurrentPage { get; private set; } = 1;
    public int LastPage => Math.Max(1, (Total + PageSize - 1) / PageSize);
    public Species? SelectedSpecies { get; private set; }

    public async Task<IActionResult> OnGetAsync(CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(Kind))
        {
            SelectedSpecies = Kind switch { "kedi" => Species.Cat, "kopek" => Species.Dog, _ => null };
            if (SelectedSpecies is null) return NotFound();
        }
        if (PageText is not null)
        {
            if (PageText.Length is 0 or > 6 || PageText[0] == '0' || !PageText.All(char.IsAsciiDigit)) return NotFound();
            CurrentPage = int.Parse(PageText, System.Globalization.CultureInfo.InvariantCulture);
            if (CurrentPage > 100000) return NotFound();
        }

        var all = await places.ListDistrictsAsync(ct);
        if (!string.IsNullOrEmpty(District))
        {
            SelectedDistrict = all.FirstOrDefault(d => d.Slug == District);
            if (SelectedDistrict is null) return NotFound();
        }
        Districts = all.Where(d => d.OpenAdoptions > 0 || d == SelectedDistrict).ToArray();

        var districtSlug = SelectedDistrict?.Slug;
        Total = await adoptions.CountAsync(districtSlug: districtSlug, species: SelectedSpecies, ct: ct);
        if (CurrentPage > LastPage) return NotFound();
        Cards = await adoptions.ListAsync(districtSlug: districtSlug, species: SelectedSpecies, page: CurrentPage, pageSize: PageSize, ct: ct);

        Crumbs = [new("Ana sayfa", Routes.Home), new("Sahiplendirme", Routes.Adoptions)];
        var what = SelectedSpecies switch
        {
            Species.Cat => "kediler",
            Species.Dog => "köpekler",
            _ => "kediler ve köpekler"
        };
        var where = SelectedDistrict is null ? "" : PublicText.In(SelectedDistrict.Name) + " ";
        var pageSuffix = CurrentPage > 1 ? $", sayfa {CurrentPage}" : "";
        var title = SelectedDistrict is null && SelectedSpecies is null
            ? $"Sahiplendirme ilanları: yuva arayan kedi ve köpekler{pageSuffix}"
            : $"{where}yuva arayan {what}{pageSuffix}";
        var description = PublicText.Description(
            $"{where}yuva arayan sokak {what}: {PublicText.Number(Total)} açık sahiplendirme ilanı. Her ilan moderasyondan geçer, 60 gün sonra ya da hayvan yuvasına kavuşunca kapanır.",
            PublicText.Filler);
        Seo(PublicText.Title(PublicText.Capitalize(title)), PublicText.Capitalize(description), Routes.Adoptions,
            noIndex: Total == 0 || SelectedDistrict is not null || SelectedSpecies is not null || PageText is not null, jsonLd:
            [ItemList("Sahiplendirme ilanları", Cards.Select(c => (PublicText.AnimalName(c), Routes.Adoption(c.Slug)))), BreadcrumbList()]);
        return Page();
    }

    /// <summary>This listing with the current filters on another page.</summary>
    public string Link(int page) => Build(SelectedDistrict?.Slug, Kind, page);

    /// <summary>This listing with another species filter, back on page one.</summary>
    public string SpeciesLink(string? kind) => Build(SelectedDistrict?.Slug, kind, 1);

    private static string Build(string? district, string? kind, int page)
    {
        var query = new List<string>();
        if (!string.IsNullOrEmpty(district)) query.Add("ilce=" + Uri.EscapeDataString(district));
        if (!string.IsNullOrEmpty(kind)) query.Add("tur=" + Uri.EscapeDataString(kind));
        if (page > 1) query.Add("sayfa=" + page);
        return query.Count == 0 ? Routes.Adoptions : Routes.Adoptions + "?" + string.Join("&", query);
    }
}
