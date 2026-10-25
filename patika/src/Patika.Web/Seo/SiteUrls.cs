using Microsoft.Extensions.Options;

namespace Patika.Web.Seo;

public sealed class SeoOptions
{
    public const string SectionName = "Web";

    /// <summary>Public origin used for canonical, Open Graph, sitemap and robots URLs. The owner sets the real one.</summary>
    public string PublicBaseUrl { get; set; } = "https://patika.app";
}

/// <summary>Turns site-relative paths into absolute public URLs on <see cref="SeoOptions.PublicBaseUrl"/>.</summary>
public sealed class SiteUrls(IOptions<SeoOptions> options)
{
    public const string DefaultOgImage = "/og/patika-default.png";

    public string BaseUrl { get; } = Normalize(options.Value.PublicBaseUrl);

    public string Absolute(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || path == "/") return BaseUrl + "/";
        if (Uri.TryCreate(path, UriKind.Absolute, out var absolute) && absolute.Scheme is "https" or "http") return absolute.ToString();
        return BaseUrl + (path.StartsWith('/') ? path : "/" + path);
    }

    private static string Normalize(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http"))
            throw new InvalidOperationException("Web:PublicBaseUrl must be an absolute http(s) URL.");
        return uri.GetLeftPart(UriPartial.Authority);
    }
}
