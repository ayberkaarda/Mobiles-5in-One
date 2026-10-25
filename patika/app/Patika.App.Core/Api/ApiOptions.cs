namespace Patika.App.Core.Api;

/// <summary>Where the API lives. Loaded from the app's embedded settings (Development points at 10.0.2.2).</summary>
public sealed class ApiOptions
{
    /// <summary>Base address ending in a slash, for example <c>http://10.0.2.2:5000/</c>. Paths are relative to <c>v1/</c>.</summary>
    public Uri BaseAddress { get; init; } = new("https://api.patika.app/");

    /// <summary>Per-request timeout; mobile networks stall, so fail and let the outbox retry.</summary>
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(20);
}
