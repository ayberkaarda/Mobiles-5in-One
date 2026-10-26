using System.Net;
using System.Text.RegularExpressions;
using Patika.Web.Seo.Documents;
using Patika.Web.Tests.Seo;
using Xunit;

namespace Patika.Web.Tests.Content;

public sealed class ContentPageTests
{
    private static readonly string[] GuideSlugs =
    [
        "sokak-kedisi-nasil-beslenir", "yarali-kedi-veya-kopek-bulursam", "sahiplenme-nasil-isler",
        "yazin-su-kisin-barinak", "kisirlastirma-ve-belediye-programlari",
    ];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public void GuidesHaveFrontMatterAnswerFaqAndAtLeast600Words()
    {
        var store = new DocumentStore();
        var guides = store.List("rehber");
        Assert.Equal(GuideSlugs.Order(), guides.Select(g => g.Slug).Order());
        foreach (var guide in guides)
        {
            Assert.True(guide.WordCount >= 600, $"{guide.Slug}: {guide.WordCount} words");
            Assert.False(string.IsNullOrWhiteSpace(guide.Answer), guide.Slug);
            Assert.InRange(MarkdownLite.CountWords(guide.Answer!), 25, 90);
            Assert.InRange(guide.Faq.Count, 3, 5);
            Assert.InRange(guide.Description.Length, 50, 200);
            Assert.True(guide.Headings.Count(h => h.Level == 2) >= 4, guide.Slug);
            Assert.Equal(guide.Headings.Count, guide.Headings.Select(h => h.Id).Distinct().Count());
            Assert.True(guide.Updated <= DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)));
        }
    }

    [Fact]
    public void LegalPagesAreMarkedDraftsWithPlaceholders()
    {
        var store = new DocumentStore();
        foreach (var slug in new[] { "gizlilik", "kvkk", "kosullar" })
        {
            var doc = Assert.IsType<ContentDoc>(store.Find("yasal", slug));
            Assert.Contains("<mark class=\"doc-ph\">[", doc.Html, StringComparison.Ordinal);
        }
        Assert.Contains("7 gün", store.Find("yasal", "kvkk")!.Html, StringComparison.Ordinal);
    }

    [Fact]
    public void MarkdownIsEncodedAndOnlySafeLinksSurvive()
    {
        var (html, headings) = MarkdownLite.Render("""
            ## Soru <b>kalın</b>? {#soru}

            <script>alert(1)</script> [iyi](/rehber) [kötü](javascript:alert(1)) [dış](https://example.org) [protokolsüz](//evil.example)
            - **madde** [ŞİRKET UNVANI]
            1. sıralı
            """);
        Assert.DoesNotContain("<script>", html, StringComparison.Ordinal);
        Assert.DoesNotContain("<b>", html, StringComparison.Ordinal);
        Assert.Contains("&lt;script&gt;", html, StringComparison.Ordinal);
        Assert.Contains("<a href=\"/rehber\">iyi</a>", html, StringComparison.Ordinal);
        Assert.Contains("<a href=\"https://example.org\" rel=\"noopener\">dış</a>", html, StringComparison.Ordinal);
        Assert.DoesNotContain("javascript:", html, StringComparison.Ordinal);
        Assert.DoesNotContain("href=\"//evil", html, StringComparison.Ordinal);
        Assert.Contains("<li><strong>madde</strong> <mark class=\"doc-ph\">[ŞİRKET UNVANI]</mark></li>", html, StringComparison.Ordinal);
        Assert.Contains("<ol>\n<li>sıralı</li>\n</ol>", html, StringComparison.Ordinal);
        Assert.Equal("soru", Assert.Single(headings).Id);
    }

    [Fact]
    public async Task GuidePagesRenderAnswerTocFaqAndValidJsonLd()
    {
        await using var factory = SeoTestHelpers.Offline();
        using var client = factory.CreateClient();
        foreach (var slug in GuideSlugs)
        {
            var html = await SeoTestHelpers.GetOkAsync(client, "/rehber/" + slug);
            Assert.Equal($"{SeoTestHelpers.BaseUrl}/rehber/{slug}", SeoTestHelpers.Canonical(html));
            Assert.Contains("class=\"doc-answer\"", html, StringComparison.Ordinal);
            Assert.Contains("<aside class=\"doc-toc\" aria-label=\"Bu yazıda\">", html, StringComparison.Ordinal);
            Assert.Contains("<h2 id=\"sss\">Sık sorulanlar</h2>", html, StringComparison.Ordinal);
            Assert.Contains("<meta property=\"og:type\" content=\"article\" />", html, StringComparison.Ordinal);

            var article = ArticleText(html);
            var words = MarkdownLite.CountWords(article);
            TestContext.Current.TestOutputHelper?.WriteLine($"{slug}: {words} rendered words before the FAQ");
            Assert.True(words >= 600, $"{slug}: {words} rendered words");

            var blocks = SeoTestHelpers.JsonLdBlocks(html);
            Assert.Equal(3, blocks.Count);
            foreach (var block in blocks) SeoTestHelpers.AssertSchema(block);
            var faq = SeoTestHelpers.OfType(blocks, "FAQPage");
            Assert.InRange(faq.GetProperty("mainEntity").GetArrayLength(), 3, 5);
            Assert.Equal("2026-10-26", SeoTestHelpers.OfType(blocks, "Article").GetProperty("dateModified").GetString());
            Assert.Equal(3, SeoTestHelpers.OfType(blocks, "BreadcrumbList").GetProperty("itemListElement").GetArrayLength());
        }
    }

    [Theory]
    [InlineData("/rehber")]
    [InlineData("/gizlilik")]
    [InlineData("/kvkk")]
    [InlineData("/kosullar")]
    [InlineData("/hesap-silme")]
    [InlineData("/hakkinda")]
    [InlineData("/sss")]
    [InlineData("/iletisim")]
    public async Task ContentPagesReturn200WithAbsoluteCanonical(string path)
    {
        await using var factory = SeoTestHelpers.Offline();
        using var client = factory.CreateClient();
        var html = await SeoTestHelpers.GetOkAsync(client, path);
        Assert.Equal(SeoTestHelpers.BaseUrl + path, SeoTestHelpers.Canonical(html));
        Assert.Contains("/css/content.css", html, StringComparison.Ordinal);
        foreach (var block in SeoTestHelpers.JsonLdBlocks(html)) SeoTestHelpers.AssertSchema(block);
        Assert.DoesNotContain("<form", html, StringComparison.Ordinal);
        if (path is "/gizlilik" or "/kvkk" or "/kosullar") Assert.Contains("Taslak: hukuki inceleme bekliyor", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FaqPageHasFaqJsonLdAndUnknownDocsAre404()
    {
        await using var factory = SeoTestHelpers.Offline();
        using var client = factory.CreateClient();
        var html = await SeoTestHelpers.GetOkAsync(client, "/sss");
        Assert.True(SeoTestHelpers.OfType(SeoTestHelpers.JsonLdBlocks(html), "FAQPage").GetProperty("mainEntity").GetArrayLength() >= 5);

        foreach (var path in new[] { "/rehber/yok-boyle-bir-rehber", "/rehber/..%2Fkvkk", "/kvkk2" })
        {
            using var response = await client.GetAsync(path, Ct);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
    }

    [Fact]
    public async Task AccountDeletionPageOffersNoWorkingLookingForm()
    {
        await using var factory = SeoTestHelpers.Offline();
        using var client = factory.CreateClient();
        var html = await SeoTestHelpers.GetOkAsync(client, "/hesap-silme");
        Assert.Contains("Hesabımı sil", html, StringComparison.Ordinal);
        Assert.Contains("7 gün", html, StringComparison.Ordinal);
        Assert.Contains("[DESTEK E-POSTA ADRESİ]", html, StringComparison.Ordinal);
        // Deleting the account does not stop a Play subscription, and a purged subscription cannot be reclaimed.
        Assert.Contains("aboneliğini durdurmaz", System.Net.WebUtility.HtmlDecode(html), StringComparison.Ordinal);
        Assert.DoesNotContain("<input", html, StringComparison.Ordinal);
        Assert.DoesNotContain("<button", html, StringComparison.Ordinal);
    }

    private static string ArticleText(string html)
    {
        var start = html.IndexOf("<article class=\"doc-body\">", StringComparison.Ordinal);
        // Body and answer box only: the FAQ section is not counted toward the 600 words.
        var end = html.IndexOf("<section class=\"doc-faq\"", start, StringComparison.Ordinal);
        return System.Net.WebUtility.HtmlDecode(TagPatternRegex.Replace(html[start..end], " "));
    }

    private static readonly Regex TagPatternRegex = new("<[^>]+>", RegexOptions.Compiled);
}
