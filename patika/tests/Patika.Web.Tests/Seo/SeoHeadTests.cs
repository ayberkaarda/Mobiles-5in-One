using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Mvc.Razor;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Patika.Web.Seo;
using Xunit;

namespace Patika.Web.Tests.Seo;

public sealed class SeoHeadTests
{
    private const string Attack = "</script><script>alert(1)</script><!--";
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public void JsonLdCannotCloseItsScriptElement()
    {
        var json = JsonLd.Serialize(new Dictionary<string, object?> { ["@type"] = "Thing", ["description"] = Attack + " Kadıköy & Moda" });
        Assert.DoesNotContain("<", json, StringComparison.Ordinal);
        Assert.DoesNotContain(">", json, StringComparison.Ordinal);
        Assert.Contains("Kadıköy", json, StringComparison.Ordinal);
        using var document = JsonDocument.Parse(json);
        Assert.Equal(Attack + " Kadıköy & Moda", document.RootElement.GetProperty("description").GetString());
    }

    [Fact]
    public async Task HeadRendersAbsoluteCanonicalNoIndexSocialTagsAndSafeJsonLd()
    {
        await using var factory = SeoTestHelpers.Offline();
        var html = await RenderHeadAsync(factory, new SeoMeta("Başlık", Attack, "/sahiplendirme/pamuk")
        {
            NoIndex = true,
            JsonLd = [new Dictionary<string, object?> { ["@context"] = "https://schema.org", ["@type"] = "Thing", ["description"] = Attack }],
        });

        Assert.Equal(SeoTestHelpers.BaseUrl + "/sahiplendirme/pamuk", SeoTestHelpers.Canonical(html));
        Assert.Contains("<meta name=\"robots\" content=\"noindex, follow\" />", html, StringComparison.Ordinal);
        Assert.DoesNotContain("hreflang", html, StringComparison.Ordinal);
        Assert.Contains($"<meta property=\"og:image\" content=\"{SeoTestHelpers.BaseUrl}/og/patika-default.png\" />", html, StringComparison.Ordinal);
        Assert.Contains("<meta name=\"twitter:card\" content=\"summary_large_image\" />", html, StringComparison.Ordinal);
        // The attack text appears only encoded: once per attribute, never as markup.
        Assert.DoesNotContain("<script>alert", html, StringComparison.Ordinal);
        Assert.Single(html.Split("</script>")[..^1]);
        var block = Assert.Single(SeoTestHelpers.JsonLdBlocks(html));
        Assert.Equal(Attack, block.GetProperty("description").GetString());
    }

    [Fact]
    public async Task IndexablePagesGetHreflangAndNoRobotsTag()
    {
        await using var factory = SeoTestHelpers.Offline();
        var html = await RenderHeadAsync(factory, new SeoMeta("Rehber", "Açıklama", "/rehber"));
        Assert.Contains($"<link rel=\"alternate\" hreflang=\"tr\" href=\"{SeoTestHelpers.BaseUrl}/rehber\" />", html, StringComparison.Ordinal);
        Assert.Contains($"<link rel=\"alternate\" hreflang=\"x-default\" href=\"{SeoTestHelpers.BaseUrl}/rehber\" />", html, StringComparison.Ordinal);
        Assert.DoesNotContain("name=\"robots\"", html, StringComparison.Ordinal);
        Assert.Empty(SeoTestHelpers.JsonLdBlocks(html));
    }

    [Fact]
    public async Task NotFoundPageIsNoIndex()
    {
        await using var factory = SeoTestHelpers.Offline();
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/bu-sayfa-yok", Ct);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Contains("content=\"noindex", await response.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("Production", true)]
    [InlineData("Staging", false)]
    [InlineData("Testing", false)]
    public async Task RobotsAllowsOnlyProductionToBeIndexed(string environment, bool indexable)
    {
        await using var factory = SeoTestHelpers.Offline(environment);
        using var client = factory.CreateClient();
        var robots = await SeoTestHelpers.GetOkAsync(client, "/robots.txt");
        var lines = robots.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        Assert.Contains("User-agent: *", lines);
        if (indexable)
        {
            Assert.Contains("Allow: /", lines);
            Assert.Contains("Disallow: /admin", lines);
            Assert.Contains("Disallow: /404", lines);
            Assert.DoesNotContain("Disallow: /", lines);
            Assert.Contains($"Sitemap: {SeoTestHelpers.BaseUrl}/sitemap.xml", lines);
        }
        else
        {
            Assert.Contains("Disallow: /", lines);
            Assert.DoesNotContain("Allow: /", lines);
        }
    }

    [Fact]
    public async Task StaticSeoFilesAreServed()
    {
        await using var factory = SeoTestHelpers.Offline();
        using var client = factory.CreateClient();

        using var assetLinks = await client.GetAsync("/.well-known/assetlinks.json", Ct);
        Assert.Equal(HttpStatusCode.OK, assetLinks.StatusCode);
        Assert.Equal("application/json", assetLinks.Content.Headers.ContentType?.MediaType);
        using var links = JsonDocument.Parse(await assetLinks.Content.ReadAsStringAsync(Ct));
        Assert.Equal("app.patika.android", links.RootElement[0].GetProperty("target").GetProperty("package_name").GetString());

        var llms = await SeoTestHelpers.GetOkAsync(client, "/llms.txt");
        Assert.StartsWith("# Patika", llms, StringComparison.Ordinal);
        Assert.Contains("/rehber/yarali-kedi-veya-kopek-bulursam", llms, StringComparison.Ordinal);

        using var og = await client.GetAsync("/og/patika-default.png", Ct);
        Assert.Equal(HttpStatusCode.OK, og.StatusCode);
        var png = await og.Content.ReadAsByteArrayAsync(Ct);
        // PNG IHDR: width and height are big-endian at bytes 16 and 20.
        Assert.Equal(1200, (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19]);
        Assert.Equal(630, (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23]);
    }

    [Fact]
    public async Task OldKvkkPathRedirectsPermanently()
    {
        await using var factory = SeoTestHelpers.Offline();
        using var client = factory.CreateClient(new() { AllowAutoRedirect = false });
        using var response = await client.GetAsync("/kvkk-aydinlatma", Ct);
        Assert.Equal(HttpStatusCode.MovedPermanently, response.StatusCode);
        Assert.Equal("/kvkk", response.Headers.Location?.OriginalString);
    }

    [Fact]
    public void BaseUrlMustBeAbsolute()
    {
        Assert.Throws<InvalidOperationException>(() => new SiteUrls(Options.Create(new SeoOptions { PublicBaseUrl = "patika.app" })));
        var urls = new SiteUrls(Options.Create(new SeoOptions { PublicBaseUrl = "https://patika.example.org/ignored/path" }));
        Assert.Equal("https://patika.example.org/", urls.Absolute("/"));
        Assert.Equal("https://patika.example.org/rehber", urls.Absolute("/rehber"));
        Assert.Equal("https://media.example.org/a.webp", urls.Absolute("https://media.example.org/a.webp"));
    }

    private static async Task<string> RenderHeadAsync(Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> factory, SeoMeta meta)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var http = new DefaultHttpContext { RequestServices = scope.ServiceProvider };
        http.Request.Path = "/test";
        var engine = scope.ServiceProvider.GetRequiredService<IRazorViewEngine>();
        var view = engine.GetView(null, "/Pages/Shared/_SeoHead.cshtml", isMainPage: false);
        Assert.True(view.Success, string.Join(", ", view.SearchedLocations ?? []));
        var viewData = new ViewDataDictionary(new EmptyModelMetadataProvider(), new ModelStateDictionary()) { [SeoMeta.Key] = meta };
        await using var writer = new StringWriter();
        var context = new ViewContext(new ActionContext(http, new RouteData(), new ActionDescriptor()), view.View, viewData,
            new TempDataDictionary(http, scope.ServiceProvider.GetRequiredService<ITempDataProvider>()), writer, new HtmlHelperOptions());
        await view.View.RenderAsync(context);
        return writer.ToString();
    }
}
