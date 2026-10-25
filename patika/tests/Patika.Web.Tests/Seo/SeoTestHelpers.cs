using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace Patika.Web.Tests.Seo;

internal static class SeoTestHelpers
{
    public const string BaseUrl = "https://patika.example.org";

    /// <summary>A site that never reaches a database: for pages and endpoints that read no public data.</summary>
    public static WebApplicationFactory<Program> Offline(string environment = "Testing") =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
            builder.UseSetting("Web:PublicBaseUrl", BaseUrl);
        });

    public static WebApplicationFactory<Program> WithDatabase(string connectionString) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", connectionString);
            builder.UseSetting("Web:PublicBaseUrl", BaseUrl);
            builder.ConfigureServices(services => services.Replace(ServiceDescriptor.Singleton<TimeProvider>(new FixedClock())));
        });

    public static async Task<string> GetOkAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.True(response.IsSuccessStatusCode, $"{path} returned {(int)response.StatusCode}");
        return body;
    }

    /// <summary>Every JSON-LD block of a page, parsed. Fails if a block is not valid JSON.</summary>
    public static IReadOnlyList<JsonElement> JsonLdBlocks(string html) =>
        JsonLdPatternRegex.Matches(html).Select(m => JsonDocument.Parse(m.Groups["json"].Value).RootElement.Clone()).ToArray();

    public static JsonElement OfType(IEnumerable<JsonElement> blocks, string type) =>
        Assert.Single(blocks, b => b.GetProperty("@type").GetString() == type);

    public static string? Canonical(string html) => CanonicalPatternRegex.Match(html) is { Success: true } m ? m.Groups["href"].Value : null;

    /// <summary>Required-property check, following Google's rich result requirements where they exist.</summary>
    public static void AssertSchema(JsonElement item)
    {
        Assert.Equal("https://schema.org", item.GetProperty("@context").GetString());
        switch (item.GetProperty("@type").GetString())
        {
            case "Article":
                foreach (var name in new[] { "headline", "datePublished", "dateModified", "image", "mainEntityOfPage" })
                    Assert.False(string.IsNullOrWhiteSpace(item.GetProperty(name).GetString()), name);
                Assert.True(DateOnly.TryParse(item.GetProperty("dateModified").GetString(), out _));
                Assert.Equal("Organization", item.GetProperty("author").GetProperty("@type").GetString());
                Assert.False(string.IsNullOrWhiteSpace(item.GetProperty("publisher").GetProperty("name").GetString()));
                AssertAbsolute(item.GetProperty("image").GetString());
                break;
            case "FAQPage":
                var questions = item.GetProperty("mainEntity").EnumerateArray().ToArray();
                Assert.NotEmpty(questions);
                foreach (var question in questions)
                {
                    Assert.Equal("Question", question.GetProperty("@type").GetString());
                    Assert.False(string.IsNullOrWhiteSpace(question.GetProperty("name").GetString()));
                    Assert.Equal("Answer", question.GetProperty("acceptedAnswer").GetProperty("@type").GetString());
                    Assert.False(string.IsNullOrWhiteSpace(question.GetProperty("acceptedAnswer").GetProperty("text").GetString()));
                }
                break;
            case "BreadcrumbList":
                var position = 0;
                foreach (var entry in item.GetProperty("itemListElement").EnumerateArray())
                {
                    Assert.Equal(++position, entry.GetProperty("position").GetInt32());
                    Assert.False(string.IsNullOrWhiteSpace(entry.GetProperty("name").GetString()));
                    AssertAbsolute(entry.GetProperty("item").GetString());
                }
                Assert.True(position >= 1);
                break;
            case "Organization":
                Assert.False(string.IsNullOrWhiteSpace(item.GetProperty("name").GetString()));
                AssertAbsolute(item.GetProperty("url").GetString());
                AssertAbsolute(item.GetProperty("logo").GetString());
                break;
            case "WebSite":
                Assert.False(string.IsNullOrWhiteSpace(item.GetProperty("name").GetString()));
                AssertAbsolute(item.GetProperty("url").GetString());
                break;
            case "VeterinaryCare" or "AnimalShelter":
                Assert.False(string.IsNullOrWhiteSpace(item.GetProperty("name").GetString()));
                AssertAbsolute(item.GetProperty("url").GetString());
                var address = item.GetProperty("address");
                Assert.Equal("PostalAddress", address.GetProperty("@type").GetString());
                Assert.False(string.IsNullOrWhiteSpace(address.GetProperty("streetAddress").GetString()));
                Assert.Equal("TR", address.GetProperty("addressCountry").GetString());
                break;
        }
    }

    public static void AssertAbsolute(string? url) =>
        Assert.True(Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "https", $"not an absolute https URL: {url}");

    private static readonly Regex JsonLdPatternRegex = new("""<script type="application/ld\+json">(?<json>.*?)</script>""", RegexOptions.Singleline | RegexOptions.Compiled);

    private static readonly Regex CanonicalPatternRegex = new("""<link rel="canonical" href="(?<href>[^"]*)" />""", RegexOptions.Compiled);
}
