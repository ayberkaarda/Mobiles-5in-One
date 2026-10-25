using System.Globalization;
using System.Text;
using System.Xml;
using Microsoft.Extensions.Caching.Memory;
using Patika.Web.Routing;
using Patika.Web.Seo.Documents;
using Patika.Web.Services.PublicQueries;

namespace Patika.Web.Seo;

public sealed record SitemapUrl(string Path, DateTimeOffset? LastModified);

/// <summary>
/// All public URLs, already split into the files the sitemap index lists ("static", "adoptions-N",
/// "districts", "care-places-N"). The chunks are filled while the rows are read, so nothing is copied
/// again per request.
/// </summary>
public sealed class SitemapSnapshot
{
    public const int ChunkSize = 10000;

    private readonly Dictionary<string, IReadOnlyList<SitemapUrl>> files = new(StringComparer.Ordinal);

    public SitemapSnapshot(IReadOnlyList<SitemapUrl> staticUrls, IReadOnlyList<List<SitemapUrl>> adoptions,
        IReadOnlyList<SitemapUrl> districts, IReadOnlyList<List<SitemapUrl>> carePlaces)
    {
        files["static"] = staticUrls;
        for (var i = 0; i < adoptions.Count; i++) files[$"adoptions-{i + 1}"] = adoptions[i];
        if (districts.Count > 0) files["districts"] = districts;
        for (var i = 0; i < carePlaces.Count; i++) files[$"care-places-{i + 1}"] = carePlaces[i];
    }

    /// <summary>File name (without .xml) to its URLs; empty data sets get no file except static.</summary>
    public IReadOnlyDictionary<string, IReadOnlyList<SitemapUrl>> Files() => files;
}

/// <summary>
/// Builds the sitemap snapshot from <see cref="ISitemapQueries"/> (paged by 10,000) plus the static
/// pages and guides, and keeps it in memory for ten minutes so the index and its files agree. One
/// rebuild runs at a time; requests that arrive meanwhile wait for it and reuse its result. The whole
/// snapshot is held in memory, which suits the current scale (tens of thousands of URLs, a few MB);
/// see docs/public-web-data.md.
/// </summary>
public sealed class SitemapService(IServiceScopeFactory scopes, IMemoryCache cache, DocumentStore documents, TimeProvider clock)
{
    private const string CacheKey = "seo:sitemap";
    private static readonly TimeZoneInfo Istanbul = TimeZoneInfo.FindSystemTimeZoneById("Europe/Istanbul");
    private readonly SemaphoreSlim rebuild = new(1, 1);

    public async Task<SitemapSnapshot> GetAsync(CancellationToken ct)
    {
        if (cache.TryGetValue(CacheKey, out SitemapSnapshot? snapshot) && snapshot is not null) return snapshot;
        await rebuild.WaitAsync(ct);
        try
        {
            if (cache.TryGetValue(CacheKey, out snapshot) && snapshot is not null) return snapshot;
            snapshot = await BuildAsync(ct);
            cache.Set(CacheKey, snapshot, TimeSpan.FromMinutes(10));
            return snapshot;
        }
        finally
        {
            rebuild.Release();
        }
    }

    private static void Add(List<List<SitemapUrl>> chunks, SitemapUrl url)
    {
        if (chunks.Count == 0 || chunks[^1].Count == SitemapSnapshot.ChunkSize) chunks.Add([]);
        chunks[^1].Add(url);
    }

    private async Task<SitemapSnapshot> BuildAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var queries = scope.ServiceProvider.GetRequiredService<ISitemapQueries>();
        var adoptions = new List<List<SitemapUrl>>();
        var districts = new List<SitemapUrl>();
        var carePlaces = new List<List<SitemapUrl>>();
        DateTimeOffset? latestAdoption = null, latestPlace = null, latestAny = null;
        static DateTimeOffset? Max(DateTimeOffset? a, DateTimeOffset? b) => a is null ? b : b is null ? a : a > b ? a : b;
        for (var page = 1; ; page++)
        {
            var rows = await queries.ListAsync(page, ct);
            foreach (var row in rows)
            {
                var url = new SitemapUrl(row.Url, row.LastModified);
                latestAny = Max(latestAny, row.LastModified);
                if (row.Url.StartsWith(Routes.Adoptions + "/", StringComparison.Ordinal))
                {
                    Add(adoptions, url);
                    latestAdoption = Max(latestAdoption, row.LastModified);
                }
                else if (row.Url.StartsWith("/istasyonlar/", StringComparison.Ordinal)) districts.Add(url);
                else if (row.Url.StartsWith("/bakim-yeri/", StringComparison.Ordinal))
                {
                    Add(carePlaces, url);
                    latestPlace = Max(latestPlace, row.LastModified);
                }
            }
            if (rows.Count < SitemapSnapshot.ChunkSize) break;
        }

        var guides = documents.List("rehber");
        var pages = documents.List("sayfa").Concat(documents.List("yasal")).ToArray();
        DateTimeOffset? Day(DateOnly date) => new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

        var staticUrls = new List<SitemapUrl>
        {
            new("/", latestAny),
            new(Routes.Adoptions, latestAdoption),
            new(Routes.CarePlaces, latestPlace),
            new(Routes.Impact, StartOfIstanbulWeek(clock.GetUtcNow())),
            new(Routes.Guides, guides.Count == 0 ? null : Day(guides.Max(g => g.Updated))),
        };
        staticUrls.AddRange(guides.Select(g => new SitemapUrl(Routes.Guide(g.Slug), Day(g.Updated))));
        staticUrls.AddRange(pages.Select(p => new SitemapUrl("/" + p.Slug, Day(p.Updated))));
        staticUrls.Add(new SitemapUrl(Routes.DeleteAccount, null));
        return new SitemapSnapshot(staticUrls, adoptions, districts, carePlaces);
    }

    /// <summary>The impact page changes every Monday 00:00 in İstanbul.</summary>
    private static DateTimeOffset StartOfIstanbulWeek(DateTimeOffset now)
    {
        var local = TimeZoneInfo.ConvertTime(now, Istanbul);
        var monday = local.Date.AddDays(-(((int)local.DayOfWeek + 6) % 7));
        return new DateTimeOffset(monday, Istanbul.GetUtcOffset(monday));
    }
}

public static class SitemapXml
{
    public const string Namespace = "http://www.sitemaps.org/schemas/sitemap/0.9";

    public static string UrlSet(SiteUrls urls, IEnumerable<SitemapUrl> entries) => Write(writer =>
    {
        writer.WriteStartElement("urlset", Namespace);
        foreach (var entry in entries)
        {
            writer.WriteStartElement("url", Namespace);
            writer.WriteElementString("loc", Namespace, urls.Absolute(entry.Path));
            if (entry.LastModified is { } lastModified) writer.WriteElementString("lastmod", Namespace, Format(lastModified));
            writer.WriteEndElement();
        }
        writer.WriteEndElement();
    });

    public static string Index(SiteUrls urls, IReadOnlyDictionary<string, IReadOnlyList<SitemapUrl>> files) => Write(writer =>
    {
        writer.WriteStartElement("sitemapindex", Namespace);
        foreach (var (name, entries) in files)
        {
            writer.WriteStartElement("sitemap", Namespace);
            writer.WriteElementString("loc", Namespace, urls.Absolute($"/sitemaps/{name}.xml"));
            if (entries.Max(e => e.LastModified) is { } lastModified) writer.WriteElementString("lastmod", Namespace, Format(lastModified));
            writer.WriteEndElement();
        }
        writer.WriteEndElement();
    });

    private static string Format(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'+00:00'", CultureInfo.InvariantCulture);

    private static string Write(Action<XmlWriter> body)
    {
        var builder = new StringBuilder();
        using (var writer = XmlWriter.Create(builder, new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = false }))
        {
            writer.WriteStartDocument();
            body(writer);
            writer.WriteEndDocument();
        }
        // StringBuilder output declares utf-16; the response is UTF-8.
        return builder.ToString().Replace("encoding=\"utf-16\"", "encoding=\"UTF-8\"", StringComparison.Ordinal);
    }
}
