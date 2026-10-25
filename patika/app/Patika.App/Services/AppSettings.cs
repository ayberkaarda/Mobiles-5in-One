using System.Reflection;
using System.Text.Json;
using Patika.App.Core.Api;

namespace Patika.App.Services;

/// <summary>
/// Settings embedded in the app: <c>appsettings.json</c>, overlaid by <c>appsettings.Development.json</c> in
/// Debug builds (the emulator reaches the host's compose stack at 10.0.2.2). No secrets live here.
/// </summary>
public static class AppSettings
{
    public static ApiOptions LoadApiOptions()
    {
        var baseUrl = Read("appsettings.json");
#if DEBUG
        baseUrl = Read("appsettings.Development.json") ?? baseUrl;
#endif
        return baseUrl is null ? new ApiOptions() : new ApiOptions { BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : baseUrl + "/") };
    }

    private static string? Read(string name)
    {
        var assembly = typeof(AppSettings).Assembly;
        var resource = assembly.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("." + name, StringComparison.Ordinal));
        if (resource is null)
        {
            return null;
        }

        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var document = JsonDocument.Parse(stream);
        return document.RootElement.TryGetProperty("Api", out var api) && api.TryGetProperty("BaseUrl", out var url)
            ? url.GetString()
            : null;
    }
}
