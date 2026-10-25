using System.Net;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Patika.Web.Seo;
using Xunit;

namespace Patika.Web.Tests.Seo;

public sealed class SitemapTests(PostgisFixture database) : IClassFixture<PostgisFixture>
{
    private static readonly XNamespace Ns = SitemapXml.Namespace;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task IndexListsEveryFileAndFilesHoldOnlyPublicUrls()
    {
        await using var factory = SeoTestHelpers.WithDatabase(database.ConnectionString);
        using var client = factory.CreateClient();

        using var indexResponse = await client.GetAsync("/sitemap.xml", Ct);
        Assert.Equal(HttpStatusCode.OK, indexResponse.StatusCode);
        Assert.Equal("application/xml", indexResponse.Content.Headers.ContentType?.MediaType);
        var index = XDocument.Parse(await indexResponse.Content.ReadAsStringAsync(Ct));
        Assert.Equal(Ns + "sitemapindex", index.Root!.Name);
        var files = index.Root.Elements(Ns + "sitemap").Select(e => e.Element(Ns + "loc")!.Value).ToArray();
        Assert.Equal(new[] { "static", "adoptions-1", "districts", "care-places-1" }.Select(f => $"{SeoTestHelpers.BaseUrl}/sitemaps/{f}.xml"), files);

        var urls = new Dictionary<string, string[]>();
        foreach (var file in files)
        {
            var document = XDocument.Parse(await SeoTestHelpers.GetOkAsync(client, new Uri(file).AbsolutePath));
            Assert.Equal(Ns + "urlset", document.Root!.Name);
            var entries = document.Root.Elements(Ns + "url").ToArray();
            Assert.NotEmpty(entries);
            foreach (var entry in entries)
            {
                SeoTestHelpers.AssertAbsolute(entry.Element(Ns + "loc")!.Value);
                Assert.StartsWith(SeoTestHelpers.BaseUrl + "/", entry.Element(Ns + "loc")!.Value, StringComparison.Ordinal);
                if (entry.Element(Ns + "lastmod") is { } lastmod) Assert.True(DateTimeOffset.TryParse(lastmod.Value, out _), lastmod.Value);
            }
            urls[new Uri(file).AbsolutePath] = entries.Select(e => new Uri(e.Element(Ns + "loc")!.Value).AbsolutePath).ToArray();
        }

        await using var db = database.CreateContext();
        var publishedSlug = await db.AdoptionPosts.Where(p => p.Id == PostgisFixture.PostId).Select(p => p.Slug).SingleAsync(Ct);
        Assert.Equal(new[] { "/sahiplendirme/" + publishedSlug }, urls["/sitemaps/adoptions-1.xml"]);
        Assert.DoesNotContain(urls.Values.SelectMany(v => v), u => u.Contains("closed-adoption", StringComparison.Ordinal));
        Assert.Equal(new[] { "/istasyonlar/istanbul/kadikoy" }, urls["/sitemaps/districts.xml"]);
        Assert.Equal(new[] { "/bakim-yeri/klinik", "/bakim-yeri/klinik-2" }, urls["/sitemaps/care-places-1.xml"]);

        var staticUrls = urls["/sitemaps/static.xml"];
        foreach (var path in new[] { "/", "/sahiplendirme", "/bakim-yerleri", "/etki", "/rehber", "/rehber/sokak-kedisi-nasil-beslenir",
                     "/rehber/yarali-kedi-veya-kopek-bulursam", "/gizlilik", "/kvkk", "/kosullar", "/hesap-silme", "/hakkinda", "/sss", "/iletisim" })
        {
            Assert.Contains(path, staticUrls);
        }
        Assert.Equal(staticUrls.Length, staticUrls.Distinct().Count());
    }

    [Theory]
    [InlineData("/sitemaps/adoptions-2.xml")]
    [InlineData("/sitemaps/adoptions-0.xml")]
    [InlineData("/sitemaps/other.xml")]
    [InlineData("/sitemaps/static.txt")]
    public async Task UnknownSitemapFilesAre404(string path)
    {
        await using var factory = SeoTestHelpers.WithDatabase(database.ConnectionString);
        using var client = factory.CreateClient();
        using var response = await client.GetAsync(path, Ct);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task HomeAndCarePlaceJsonLdMatchSchemaOrg()
    {
        await using var factory = SeoTestHelpers.WithDatabase(database.ConnectionString);
        using var client = factory.CreateClient();

        var home = await SeoTestHelpers.GetOkAsync(client, "/");
        Assert.Equal(SeoTestHelpers.BaseUrl + "/", SeoTestHelpers.Canonical(home));
        var homeBlocks = SeoTestHelpers.JsonLdBlocks(home);
        SeoTestHelpers.AssertSchema(SeoTestHelpers.OfType(homeBlocks, "Organization"));
        SeoTestHelpers.AssertSchema(SeoTestHelpers.OfType(homeBlocks, "WebSite"));

        var place = await SeoTestHelpers.GetOkAsync(client, "/bakim-yeri/klinik");
        var placeBlocks = SeoTestHelpers.JsonLdBlocks(place);
        Assert.NotEmpty(placeBlocks);
        foreach (var block in placeBlocks) SeoTestHelpers.AssertSchema(block);
        Assert.Equal("Klinik", SeoTestHelpers.OfType(placeBlocks, "VeterinaryCare").GetProperty("name").GetString());
        Assert.DoesNotContain(placeBlocks, b => b.GetProperty("@type").GetString() == "Organization");
    }
}
