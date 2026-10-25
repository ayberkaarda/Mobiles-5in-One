namespace Patika.App.Core.Media;

/// <summary>
/// Where photos may be PUT: exact origins (scheme, host, port) from the app's settings. HTTPS only, except
/// the emulator's host alias and loopback in Debug builds, which the app passes as <c>cleartextHosts</c>.
/// </summary>
public sealed class StorageOrigins
{
    private readonly HashSet<string> origins;
    private readonly HashSet<string> cleartextHosts;

    public StorageOrigins(IEnumerable<string> origins, IEnumerable<string>? cleartextHosts = null)
    {
        this.cleartextHosts = new HashSet<string>(cleartextHosts ?? [], StringComparer.OrdinalIgnoreCase);
        this.origins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var origin in origins)
        {
            if (Uri.TryCreate(origin, UriKind.Absolute, out var uri) && IsAllowedScheme(uri))
            {
                this.origins.Add(Origin(uri));
            }
        }
    }

    /// <summary>The Debug exception: the emulator's alias for the host and loopback.</summary>
    public static IReadOnlyList<string> DevelopmentCleartextHosts { get; } = ["10.0.2.2", "localhost", "127.0.0.1"];

    public bool Allows(Uri target) =>
        target.IsAbsoluteUri && IsAllowedScheme(target) && target.UserInfo.Length == 0 && origins.Contains(Origin(target));

    /// <summary>The storage client: no redirects, no cookies, no API token.</summary>
    public static HttpClient CreateClient(TimeSpan timeout) =>
        new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = timeout };

    private bool IsAllowedScheme(Uri uri) =>
        uri.Scheme == Uri.UriSchemeHttps || (uri.Scheme == Uri.UriSchemeHttp && cleartextHosts.Contains(uri.Host));

    private static string Origin(Uri uri) => $"{uri.Scheme}://{uri.IdnHost}:{uri.Port}".ToLowerInvariant();
}
