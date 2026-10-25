using Microsoft.AspNetCore.Mvc;
using Patika.Domain.Entities;
using Patika.Web.Routing;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Pages.Sahiplendirme;

public sealed class DetailModel(IAdoptionQueries adoptions, TimeProvider clock) : PublicPageModel(clock)
{
    public AdoptionDetail Post { get; private set; } = null!;
    public AdoptionCard Card => Post.Card;
    public string Name => PublicText.AnimalName(Card);
    public IReadOnlyList<AdoptionCard> Others { get; private set; } = [];

    public async Task<IActionResult> OnGetAsync(string slug, CancellationToken ct)
    {
        if (await adoptions.GetBySlugAsync(slug, ct) is not { } post) return NotFound();
        Post = post;
        if (Card.DistrictSlug is not null)
        {
            Others = (await adoptions.ListAsync(districtSlug: Card.DistrictSlug, pageSize: 7, ct: ct))
                .Where(c => c.Slug != Card.Slug).Take(6).ToArray();
        }

        Crumbs = Card.DistrictName is null
            ? [new("Ana sayfa", Routes.Home), new("Sahiplendirme", Routes.Adoptions), new(Name)]
            : [new("Ana sayfa", Routes.Home), new("Sahiplendirme", Routes.Adoptions),
                new(Card.DistrictName, Routes.Adoptions + "?ilce=" + Uri.EscapeDataString(Card.DistrictSlug!)), new(Name)];

        var species = PublicText.SpeciesLower(Card.Species);
        var where = Card.DistrictName is null ? "" : PublicText.In(Card.DistrictName) + " ";
        var title = PublicText.Title($"{Name}: {where}sahiplendirilen {species}");
        var description = PublicText.Description($"{Lede} İlan {PublicText.Date(Post.ClosesAt)} tarihinde kapanır; talep Patika uygulamasından gönderilir.",
            PublicText.Filler);
        var page = new Dictionary<string, object>
        {
            ["@context"] = "https://schema.org",
            ["@type"] = "WebPage",
            ["name"] = $"{Name}, sahiplendirme ilanı",
            ["description"] = description,
            ["url"] = Urls.Absolute(Routes.Adoption(Card.Slug)),
            ["inLanguage"] = "tr",
            ["expires"] = Post.ClosesAt.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)
        };
        if (Post.Photos.Count > 0) page["primaryImageOfPage"] = new Dictionary<string, object> { ["@type"] = "ImageObject", ["contentUrl"] = Post.Photos[0] };
        Seo(title, description, Routes.Adoption(Card.Slug), jsonLd: [page, BreadcrumbList()], imagePath: Post.Photos.FirstOrDefault(),
            imageAlt: Post.Photos.Count > 0 ? $"{Name}, fotoğraf 1" : null);
        return Page();
    }

    /// <summary>"Pamuk, Kadıköy’de gönüllülerin baktığı dişi bir sokak kedisi. Kısırlaştırılmış, aşılı ve kulak küpeli."</summary>
    public string Lede
    {
        get
        {
            var sex = Card.Sex switch { AnimalSex.Female => "dişi ", AnimalSex.Male => "erkek ", _ => "" };
            var where = Card.DistrictName is null ? "" : PublicText.In(Card.DistrictName) + " ";
            var age = PublicText.Age(Card.BirthYear, Now);
            var animal = Card.Species switch { Species.Cat => "sokak kedisi", Species.Dog => "sokak köpeği", _ => "sokak hayvanı" };
            var health = new List<string>();
            if (Card.Sterilized) health.Add("kısırlaştırılmış");
            if (Card.Vaccinated) health.Add("aşılı");
            if (Card.EarTagged) health.Add("kulak küpeli");
            var text = $"{Name}, {where}gönüllülerin baktığı {sex}bir {animal}{(age is null ? "" : $", {age}")}.";
            if (health.Count > 0)
            {
                var list = health.Count == 1 ? health[0] : string.Join(", ", health.Take(health.Count - 1)) + " ve " + health[^1];
                text += " " + PublicText.Capitalize(list) + ".";
            }
            return text;
        }
    }
}
