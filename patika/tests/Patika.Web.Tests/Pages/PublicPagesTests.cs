using System.Net;
using System.Text.RegularExpressions;
using Patika.Web.Pages;
using Patika.Web.Pages.BakimYeri;
using Patika.Web.Routing;
using Xunit;

namespace Patika.Web.Tests.Pages;

public sealed partial class PublicPagesTests(PageFixture site) : IClassFixture<PageFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private string[] IndexablePages =>
    [
        Routes.Home,
        Routes.Adoptions,
        Routes.Adoption(site.CatSlug),
        Routes.Adoption(site.DogSlug),
        Routes.Province("istanbul"),
        Routes.District("istanbul", "kadikoy"),
        Routes.District("istanbul", "uskudar"),
        Routes.CarePlaces,
        Routes.CarePlace(site.VetSlug),
        Routes.CarePlace(site.ShelterSlug),
        Routes.Impact
    ];

    private async Task<(HttpStatusCode Status, string Html)> GetAsync(string path)
    {
        using var client = site.Factory.CreateClient();
        using var response = await client.GetAsync(path, Ct);
        return (response.StatusCode, WebUtility.HtmlDecode(await response.Content.ReadAsStringAsync(Ct)));
    }

    [Fact]
    public async Task EveryPageRendersWithOneHeadingAndTheLandmarks()
    {
        foreach (var path in IndexablePages)
        {
            var (status, html) = await GetAsync(path);
            Assert.True(status == HttpStatusCode.OK, $"{path} returned {status}");
            Assert.Single(H1().Matches(html));
            Assert.Contains("<main id=\"icerik\">", html, StringComparison.Ordinal);
            Assert.Contains("<nav class=\"masthead__nav\" aria-label=\"Ana menü\">", html, StringComparison.Ordinal);
            Assert.Contains("<footer class=\"footer\">", html, StringComparison.Ordinal);
            Assert.DoesNotContain("noindex", html, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task TitlesAndDescriptionsArePresentSizedAndUnique()
    {
        var titles = new HashSet<string>();
        var descriptions = new HashSet<string>();
        foreach (var path in IndexablePages)
        {
            var (_, html) = await GetAsync(path);
            var title = Title().Match(html).Groups[1].Value;
            var description = Description().Match(html).Groups[1].Value;
            Assert.InRange(title.Length, 10, 60);
            Assert.InRange(description.Length, 120, 160);
            Assert.True(titles.Add(title), $"duplicate title on {path}: {title}");
            Assert.True(descriptions.Add(description), $"duplicate description on {path}");
        }
        Assert.Contains("Kadıköy’de sokak hayvanı istasyonları | Patika", titles);
    }

    [Theory]
    [InlineData("/sahiplendirme/olmayan-ilan")]
    [InlineData("/bakim-yeri/olmayan-yer")]
    [InlineData("/istasyonlar/ankara")]
    [InlineData("/istasyonlar/istanbul/olmayan-ilce")]
    [InlineData("/istasyonlar/ankara/kadikoy")]
    [InlineData("/sahiplendirme?ilce=olmayan")]
    [InlineData("/sahiplendirme?tur=kus")]
    [InlineData("/sahiplendirme?sayfa=9")]
    [InlineData("/sahiplendirme?sayfa=0")]
    [InlineData("/bakim-yerleri?tur=otel")]
    [InlineData("/bakim-yerleri?acik24=evet")]
    public async Task UnknownSlugsAndFilterValuesAreRealNotFounds(string path)
    {
        var (status, html) = await GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, status);
        Assert.Contains("Bu patika burada bitiyor.", html, StringComparison.Ordinal);
        Assert.Contains("noindex", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ThinPagesAndFilteredViewsAreNotIndexed()
    {
        var (status, html) = await GetAsync(Routes.District("istanbul", "adalar"));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Contains("<meta name=\"robots\" content=\"noindex", html, StringComparison.Ordinal);
        Assert.Contains("Adalar’da henüz kayıtlı istasyon yok.", html, StringComparison.Ordinal);

        foreach (var path in new[] { "/sahiplendirme?tur=kedi", "/sahiplendirme?ilce=uskudar", "/bakim-yerleri?acik24=1" })
        {
            (_, html) = await GetAsync(path);
            Assert.Contains("<meta name=\"robots\" content=\"noindex", html, StringComparison.Ordinal);
            Assert.DoesNotContain("<link rel=\"canonical\" href=\"https://patika.test/sahiplendirme?", html, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task NoIdentityPhotoKeyOrPreciseLocationReachesAnyPage()
    {
        var everything = IndexablePages.Concat(["/sahiplendirme?tur=kopek", "/bakim-yerleri?tur=veteriner", Routes.District("istanbul", "adalar")]);
        foreach (var path in everything)
        {
            var (_, html) = await GetAsync(path);
            foreach (var secret in new[] { "private@example.org", "Private Person", PostgisFixture.UserId.ToString(), "10000000-0000-0000-0000",
                "41.123", "29.123", "41,123", "29,123", "29.031", "40.991", "station/", "Yerel Gönüllü" })
            {
                Assert.False(html.Contains(secret, StringComparison.OrdinalIgnoreCase), $"{path} leaks {secret}");
            }
        }
    }

    [Fact]
    public async Task AdoptionFiltersNarrowTheList()
    {
        var (_, all) = await GetAsync("/sahiplendirme");
        Assert.Contains(">Pamuk<", all, StringComparison.Ordinal);
        Assert.Contains(">Karabaş<", all, StringComparison.Ordinal);
        Assert.Contains("1–2 / 2 ilan", all, StringComparison.Ordinal);

        var (_, dogs) = await GetAsync("/sahiplendirme?tur=kopek");
        Assert.Contains(">Karabaş<", dogs, StringComparison.Ordinal);
        Assert.DoesNotContain(">Pamuk<", dogs, StringComparison.Ordinal);
        Assert.Contains("aria-current=\"true\">Köpek</a>", dogs, StringComparison.Ordinal);

        var (_, kadikoy) = await GetAsync("/sahiplendirme?ilce=kadikoy&tur=kedi");
        Assert.Contains(">Pamuk<", kadikoy, StringComparison.Ordinal);
        Assert.DoesNotContain(">Karabaş<", kadikoy, StringComparison.Ordinal);
        Assert.Contains("<option value=\"kadikoy\" selected=\"selected\">Kadıköy</option>", kadikoy, StringComparison.Ordinal);

        var (_, none) = await GetAsync("/sahiplendirme?ilce=uskudar&tur=kedi");
        Assert.Contains("Bu süzgeçle şu an açık ilan yok.", none, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CarePlaceFiltersNarrowTheList()
    {
        var (_, all) = await GetAsync("/bakim-yerleri");
        Assert.Contains("Kuşdili Veteriner Kliniği", all, StringComparison.Ordinal);
        Assert.Contains("Üsküdar Barınağı", all, StringComparison.Ordinal);
        Assert.Contains("href=\"tel:+902160000000\"", all, StringComparison.Ordinal);

        var (_, shelters) = await GetAsync("/bakim-yerleri?tur=barinak");
        Assert.Contains("Üsküdar Barınağı", shelters, StringComparison.Ordinal);
        Assert.DoesNotContain("Kuşdili Veteriner Kliniği", shelters, StringComparison.Ordinal);

        var (_, open) = await GetAsync("/bakim-yerleri?acik24=1");
        Assert.Contains("Kuşdili Veteriner Kliniği", open, StringComparison.Ordinal);
        Assert.DoesNotContain("Üsküdar Barınağı", open, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DistrictPageShowsCountsTableCarePlacesAndListings()
    {
        var (_, html) = await GetAsync(Routes.District("istanbul", "kadikoy"));
        Assert.Contains("Kadıköy’de mama ve su istasyonları", html, StringComparison.Ordinal);
        Assert.Contains("<span class=\"num\">2</span> istasyon var", html, StringComparison.Ordinal);
        Assert.Contains("istasyonda mama bitti", html, StringComparison.Ordinal);
        Assert.Contains("<th scope=\"col\">Son besleme</th>", html, StringComparison.Ordinal);
        Assert.Contains("Mama bitti", html, StringComparison.Ordinal);
        Assert.Contains("1.284", html, StringComparison.Ordinal);
        Assert.Contains("İsimsiz istasyon", html, StringComparison.Ordinal);
        Assert.Contains($"href=\"{Routes.CarePlace(site.VetSlug)}\"", html, StringComparison.Ordinal);
        Assert.Contains($"href=\"{Routes.Adoption(site.CatSlug)}\"", html, StringComparison.Ordinal);
        Assert.Contains("\"@type\":\"BreadcrumbList\"", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DetailPagesCarryTheirFactsAndStructuredData()
    {
        var (_, dog) = await GetAsync(Routes.Adoption(site.DogSlug));
        Assert.Contains("Karabaş, Üsküdar’da gönüllülerin baktığı erkek bir sokak köpeği, yaklaşık 4 yaşında.", dog, StringComparison.Ordinal);
        Assert.Contains("https://media.example.org/", dog, StringComparison.Ordinal);
        Assert.Contains("alt=\"Karabaş, fotoğraf 1\"", dog, StringComparison.Ordinal);
        Assert.Contains("24 Kasım 2026", dog, StringComparison.Ordinal);
        Assert.Contains("Uygulamada talep gönder", dog, StringComparison.Ordinal);
        Assert.DoesNotContain("<form", dog, StringComparison.Ordinal);
        Assert.Contains("\"@type\":\"WebPage\"", dog, StringComparison.Ordinal);

        var (_, vet) = await GetAsync(Routes.CarePlace(site.VetSlug));
        Assert.Contains("\"@type\":\"VeterinaryCare\"", vet, StringComparison.Ordinal);
        Assert.Contains("Her gün, 24 saat", vet, StringComparison.Ordinal);

        var (_, shelter) = await GetAsync(Routes.CarePlace(site.ShelterSlug));
        Assert.Contains("\"@type\":\"AnimalShelter\"", shelter, StringComparison.Ordinal);
        Assert.Contains("\"openingHours\":[\"Mo-Tu 09:00-17:00\"]", shelter, StringComparison.Ordinal);
        Assert.Contains("Telefon bilgisi yok", shelter, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ListsAndImpactCarryStructuredData()
    {
        var (_, list) = await GetAsync(Routes.Adoptions);
        Assert.Contains("\"@type\":\"ItemList\"", list, StringComparison.Ordinal);
        var (_, impact) = await GetAsync(Routes.Impact);
        Assert.Contains("Geçen hafta", impact, StringComparison.Ordinal);
        Assert.Contains("<th scope=\"row\">12–18 Ekim</th>", impact, StringComparison.Ordinal);
        Assert.Contains("\"@type\":\"Dataset\"", impact, StringComparison.Ordinal);
    }

    [Fact]
    public async Task LayoutLinksUseTheRouteTable()
    {
        var (_, html) = await GetAsync(Routes.Home);
        foreach (var path in new[] { Routes.Adoptions, Routes.CarePlaces, Routes.Guides, Routes.Impact, Routes.Privacy, Routes.Kvkk,
            Routes.Terms, Routes.DeleteAccount, Routes.About, Routes.Faq, Routes.Contact, Routes.Province("istanbul") })
        {
            Assert.Contains($"href=\"{path}\"", html, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void TurkishWordingHelpers()
    {
        Assert.Equal("Kadıköy’de", PublicText.In("Kadıköy"));
        Assert.Equal("Üsküdar’da", PublicText.In("Üsküdar"));
        Assert.Equal("Beşiktaş’ta", PublicText.In("Beşiktaş"));
        Assert.Equal("Şişli’de", PublicText.In("Şişli"));
        Assert.Equal("İstanbul’da", PublicText.In("İstanbul"));
        Assert.Equal("1.284", PublicText.Number(1284));
        Assert.Equal("28 Eylül–4 Ekim", PublicText.Week(new DateOnly(2026, 9, 28)));
        Assert.Equal("29 Aralık 2025–4 Ocak 2026", PublicText.Week(new DateOnly(2025, 12, 29)));
        Assert.Equal("tel:+902160000000", PublicText.TelHref("0216 000 00 00"));
        Assert.Null(PublicText.TelHref("yok"));
        Assert.InRange(PublicText.Description("Kısa.", PublicText.Filler).Length, 120, 160);
        Assert.InRange(PublicText.Description(new string('a', 30) + " " + new string('b', 200), PublicText.Filler).Length, 120, 160);
    }

    [Fact]
    public void OpeningHoursAcceptsTheObviousShapeAndIgnoresTheRest()
    {
        var hours = OpeningHours.Parse("""{"mon":"09:00-18:00","tue":"9.00 - 18.00","sat":["10:00-13:00","14:00-17:00"],"sun":"closed"}""", false);
        Assert.Equal(["Mo-Tu 09:00-18:00", "Sa 10:00-13:00", "Sa 14:00-17:00"], hours.Schema);
        Assert.Equal("Pazartesi–Salı", hours.Lines[0].Days);
        Assert.Equal("Kapalı", hours.Lines[1].Hours);
        Assert.Empty(OpeningHours.Parse("{}", false).Lines);
        Assert.Empty(OpeningHours.Parse("not json", false).Lines);
        Assert.Empty(OpeningHours.Parse("""{"mon":"24:30-25:00"}""", false).Lines);
        Assert.Equal(["Mo-Su 00:00-23:59"], OpeningHours.Parse(null, true).Schema);
    }

    [GeneratedRegex("<h1[ >]")]
    private static partial Regex H1();

    [GeneratedRegex("<title>(.*?)</title>")]
    private static partial Regex Title();

    [GeneratedRegex("<meta name=\"description\" content=\"(.*?)\" />")]
    private static partial Regex Description();
}
