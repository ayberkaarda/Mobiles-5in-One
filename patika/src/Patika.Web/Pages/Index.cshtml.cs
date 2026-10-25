using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Patika.Web.Pages;

/// <summary>
/// Home page. Until the API is wired in, every animal, place and number shown here is
/// sample content and is marked [ÖRNEK] on the page.
/// </summary>
public sealed class IndexModel : PageModel
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

    public IReadOnlyList<AdoptionTag> Adoptions { get; } =
    [
        new("Pamuk", "Dişi kedi, yaklaşık 2 yaşında", "Moda, Kadıköy", Sterilized: true, Vaccinated: true, EarTagged: true, Species.Cat),
        new("Zeytin", "Erkek kedi, 8 aylık", "Yeldeğirmeni, Kadıköy", Sterilized: false, Vaccinated: true, EarTagged: false, Species.Cat),
        new("Karabaş", "Erkek köpek, yaklaşık 4 yaşında", "Caferağa, Kadıköy", Sterilized: true, Vaccinated: true, EarTagged: true, Species.Dog)
    ];

    public IReadOnlyList<CarePlace> CarePlaces { get; } =
    [
        new("Kuşdili Veteriner Kliniği", "650 m", OpenAllDay: true),
        new("Mahalle Geçici Bakımevi", "2,1 km", OpenAllDay: false),
        new("Yoğurtçu Hayvan Hastanesi", "3,4 km", OpenAllDay: true)
    ];

    public void OnGet()
    {
    }
}

public enum StopKind
{
    Fed,
    Water,
    Empty,
    Urgent
}

public enum Species
{
    Cat,
    Dog
}

public sealed record RoundStop(string Time, string Place, StopKind Kind, string Text);

public sealed record AdoptionTag(
    string Name, string Summary, string District,
    bool Sterilized, bool Vaccinated, bool EarTagged, Species Species);

public sealed record CarePlace(string Name, string Distance, bool OpenAllDay);
