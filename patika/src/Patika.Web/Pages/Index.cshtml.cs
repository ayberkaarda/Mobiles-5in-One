using Microsoft.AspNetCore.OutputCaching;
using Patika.Web.Routing;
using Patika.Web.Services;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages;

/// <summary>
/// Home page. The morning-round story and the map are an illustration (marked [ÖRNEK]); the adoption
/// tags, care places and the impact sentence come from the public queries.
/// </summary>
[OutputCache(PolicyName = CachePolicies.Listing)]
public sealed class IndexModel(IAdoptionQueries adoptions, ICarePlaceQueries carePlaces, IImpactQueries impact, TimeProvider clock)
    : PublicPageModel(clock)
{
    public IReadOnlyList<RoundStop> Round { get; } =
    [
        new("07.40", "Moda Cad. istasyonu", StopKind.Fed,
            "İki kap mama, bir kap su. Gönüllü “Beslendi” dedi, haritadaki istasyon yeşile döndü. Sonraki gelen bugün beslendiğini görür, mamayı başka bir sokağa götürür."),
        new("07.58", "Bahariye arka sokağı", StopKind.Water,
            "Su kabı devrilmiş. Bir kap su bırakmak bir dakika sürüyor; istasyon kaydı “su var” olarak güncellenir."),
        new("08.15", "Kuşdili Cad. köşesi", StopKind.Empty,
            "Mama bitti işareti. Yakındaki gönüllüler haritada turuncu halkayı görür, akşam turunda dolduran işareti kaldırır."),
        new("08.32", "Moda Parkı girişi", StopKind.Urgent,
            "Topallayan bir köpek. Acil yardım çağrısı 2 km içindeki gönüllülere gider; en yakın 24 saat açık veteriner aynı ekranda.")
    ];

    public IReadOnlyList<AdoptionCard> Adoptions { get; private set; } = [];
    public IReadOnlyList<CarePlaceView> CarePlaces { get; private set; } = [];
    public ImpactWeek LastWeek { get; private set; } = null!;

    public async Task OnGetAsync(CancellationToken ct)
    {
        Adoptions = await adoptions.ListAsync(pageSize: 3, ct: ct);
        var open = await carePlaces.ListAsync(open24h: true, limit: 3, ct: ct);
        CarePlaces = open.Count == 3 ? open : [.. open, .. await carePlaces.ListAsync(open24h: false, limit: 3 - open.Count, ct: ct)];
        LastWeek = (await impact.GetAsync(ct)).LastWeek;

        Seo("Patika: sokak hayvanları için mahalle gönüllüleri",
            "Mama istasyonları haritası, besleme takibi, sahiplendirme, acil yardım ve en yakın veteriner. Mahallenin patilerini birlikte koruyalım.",
            Routes.Home);
    }
}

public enum StopKind
{
    Fed,
    Water,
    Empty,
    Urgent
}

public sealed record RoundStop(string Time, string Place, StopKind Kind, string Text);
