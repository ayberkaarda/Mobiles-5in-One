using System.Text;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using System.Text.Unicode;
using Microsoft.Extensions.WebEncoders;
using Patika.Web.Routing;
using Patika.Web.Seo.Documents;

namespace Patika.Web.Seo;

public static class SeoEndpoints
{
    private const string XmlType = "application/xml; charset=utf-8";

    public static IServiceCollection AddSeo(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<SeoOptions>(configuration.GetSection(SeoOptions.SectionName));
        // Razor's default encoder writes every Turkish letter as an entity (ı becomes &#x131;); titles,
        // descriptions and body text are read by crawlers and should stay plain. <, >, &, quotes stay encoded.
        services.Configure<WebEncoderOptions>(options => options.TextEncoderSettings = new TextEncoderSettings(UnicodeRanges.All));
        services.AddSingleton<SiteUrls>();
        services.AddSingleton<DocumentStore>();
        services.AddMemoryCache();
        services.AddSingleton<SitemapService>();
        return services;
    }

    /// <summary>Maps robots.txt, the sitemap index and its files, and the old KVKK path the app links to.</summary>
    public static IEndpointRouteBuilder MapSeo(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/robots.txt", (IHostEnvironment environment, SiteUrls urls) =>
                Results.Text(Robots(environment.IsProduction(), urls), "text/plain; charset=utf-8"))
            .CacheOutput(policy => policy.Expire(TimeSpan.FromHours(1)).Tag("public-data"));

        endpoints.MapGet("/sitemap.xml", async (SitemapService sitemaps, SiteUrls urls, CancellationToken ct) =>
                Results.Text(SitemapXml.Index(urls, (await sitemaps.GetAsync(ct)).Files()), XmlType, Encoding.UTF8))
            .CacheOutput(policy => policy.NoCache()); // SitemapService keeps the only copy: at most 10 minutes stale

        endpoints.MapGet("/sitemaps/{file}", async (string file, SitemapService sitemaps, SiteUrls urls, CancellationToken ct) =>
            {
                var match = FilePatternRegex.Match(file);
                if (!match.Success) return Results.NotFound();
                var files = (await sitemaps.GetAsync(ct)).Files();
                return files.TryGetValue(match.Groups["name"].Value, out var entries)
                    ? Results.Text(SitemapXml.UrlSet(urls, entries), XmlType, Encoding.UTF8)
                    : Results.NotFound();
            })
            .CacheOutput(policy => policy.NoCache()); // SitemapService keeps the only copy: at most 10 minutes stale

        // The app (ProfileViewModels.KvkkUrl) and the footer link here; the canonical page is /kvkk.
        endpoints.MapGet("/kvkk-aydinlatma", () => Results.Redirect(Routes.Kvkk, permanent: true));
        return endpoints;
    }

    public static string Robots(bool production, SiteUrls urls) => production
        ? $"""
          User-agent: *
          Allow: /
          Disallow: /admin
          Disallow: {Routes.NotFound}

          Sitemap: {urls.Absolute("/sitemap.xml")}

          """
        : """
          # Not the production site: keep every page out of search indexes.
          User-agent: *
          Disallow: /

          """;

    private static readonly Regex FilePatternRegex = new(@"^(?<name>static|districts|adoptions-[1-9][0-9]{0,4}|care-places-[1-9][0-9]{0,4})\.xml$", RegexOptions.Compiled);
}
