namespace Patika.App.Core.Location;

public enum LocationAccess
{
    Granted,

    /// <summary>Refused this time; asking again is allowed.</summary>
    Denied,

    /// <summary>Refused with "don't ask again" or blocked by policy: only the system settings can change it.</summary>
    Blocked,

    /// <summary>The device has location turned off or has no provider.</summary>
    Unavailable,
}

/// <summary>A one-off position. It is held by the caller for the action at hand and never stored.</summary>
public sealed record GeoFix(double Latitude, double Longitude, double? AccuracyMeters, DateTimeOffset At);

/// <summary>
/// Foreground ("while using the app") location only; there is no background permission in the app.
/// The position is never persisted, logged or sent by this service. Only features that need it send it
/// (station create, urgent post), at the moment the user acts.
/// </summary>
public interface ILocationService
{
    Task<LocationAccess> GetAccessAsync();

    /// <summary>Shows <paramref name="rationale"/> first, then asks the system if access is not already granted.</summary>
    Task<LocationAccess> RequestAccessAsync(string rationale);

    /// <summary>The current position, or null when access is missing or no fix arrives in time.</summary>
    Task<GeoFix?> GetCurrentAsync(CancellationToken ct = default);
}

/// <summary>Why the app asks, in the words shown before the system prompt.</summary>
public static class LocationRationale
{
    public const string Map = "Yakınındaki istasyonları göstermek için konumunu yalnızca şu an kullanırız. Konumun kaydedilmez.";
    public const string Station = "İstasyonu doğru yere koymak için konumunu bir kez kullanırız. Konumun profilinde saklanmaz.";
    public const string Urgent = "Yardım çağrısını yakındaki gönüllülere iletmek için çağrının yerini kullanırız.";
}
