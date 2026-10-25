using System.Globalization;
using Patika.App.Core.Api;
using Patika.Contracts.CarePlaces;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Patika.Contracts.Urgent;

namespace Patika.App.ViewModels.Urgent;

/// <summary>Routes of the urgent screens that are not in the shared route table, and their query keys.</summary>
public static class UrgentRoutes
{
    /// <summary>One urgent post; also where a tapped urgent notification leads.</summary>
    public const string Detail = "acil-cagri";

    /// <summary>Choose the home area by moving it on a drawn map.</summary>
    public const string AreaPick = "acil-bolge";

    public const string LatitudeKey = "lat";
    public const string LongitudeKey = "lng";
}

/// <summary>
/// Local previews of urgent photos (already sanitized JPEGs) in the app cache. Only files this class names
/// (<c>urgent-*.jpg</c>) are ever deleted.
/// </summary>
public sealed class UrgentPreviewFiles(string directory)
{
    public const string Pattern = "urgent-*.jpg";

    public string Directory => directory;

    public string NewPath() => Path.Combine(directory, $"urgent-{Guid.NewGuid():N}.jpg");

    /// <summary>Deletes every preview; returns how many were removed.</summary>
    public int DeleteAll()
    {
        if (!System.IO.Directory.Exists(directory))
        {
            return 0;
        }

        var removed = 0;
        foreach (var file in System.IO.Directory.EnumerateFiles(directory, Pattern, SearchOption.TopDirectoryOnly))
        {
            try
            {
                File.Delete(file);
                removed++;
            }
            catch (IOException)
            {
                // Still open by the image view; the OS clears the cache folder later.
            }
        }

        return removed;
    }
}

/// <summary>Typed calls for urgent posts, care places and the urgent opt-in, over the shared client.</summary>
public sealed class UrgentApi(PatikaApiClient api)
{
    public const int NearRadiusMeters = 2000;
    public const int CarePlaceRadiusMeters = 5000;

    public PatikaApiClient Client => api;

    public async Task<IReadOnlyList<UrgentPostResponse>> NearAsync(double latitude, double longitude, CancellationToken ct = default)
    {
        var result = await api.SendAsync<UrgentPostListResponse>(HttpMethod.Get,
            $"urgent?near={Near(latitude, longitude)}&radius={NearRadiusMeters}", null, AuthMode.Optional, ct: ct);
        return result?.Items ?? [];
    }

    public async Task<UrgentPostResponse> GetAsync(Guid id, CancellationToken ct = default) =>
        await api.SendAsync<UrgentPostResponse>(HttpMethod.Get, $"urgent/{id:D}", null, AuthMode.Optional, ct: ct)
        ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);

    /// <param name="idempotencyKey">Stable for one draft, so a retry after a lost response cannot open two posts.</param>
    public async Task<UrgentPostResponse> CreateAsync(CreateUrgentPostRequest request, string idempotencyKey,
        CancellationToken ct = default) =>
        await api.SendAsync<UrgentPostResponse>(HttpMethod.Post, "urgent", request, AuthMode.Required, idempotencyKey, ct)
        ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);

    public async Task<UrgentPostResponse> SetStateAsync(Guid id, string state, CancellationToken ct = default) =>
        await api.SendAsync<UrgentPostResponse>(HttpMethod.Patch, $"urgent/{id:D}", new UpdateUrgentPostRequest(state),
            AuthMode.Required, ct: ct) ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);

    /// <summary>The signed-in user's latest posts (first page); used to know whether a post is one's own.</summary>
    public async Task<IReadOnlyList<UrgentPostResponse>> MineAsync(CancellationToken ct = default)
    {
        var page = await api.SendAsync<PageResponse<UrgentPostResponse>>(HttpMethod.Get, "me/urgent-posts?page=1&pageSize=50",
            null, AuthMode.Required, ct: ct);
        return page?.Items ?? [];
    }

    public async Task<IReadOnlyList<CarePlaceResponse>> CarePlacesAsync(double latitude, double longitude, CancellationToken ct = default)
    {
        var places = await api.SendAsync<CarePlaceResponse[]>(HttpMethod.Get,
            $"care-places?near={Near(latitude, longitude)}&radius={CarePlaceRadiusMeters}&pageSize=5", null, AuthMode.Optional, ct: ct);
        return places ?? [];
    }

    public async Task<UrgentSettingsResponse> GetSettingsAsync(CancellationToken ct = default) =>
        await api.SendAsync<UrgentSettingsResponse>(HttpMethod.Get, "me/urgent-settings", null, AuthMode.Required, ct: ct)
        ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);

    public async Task<UrgentSettingsResponse> PutSettingsAsync(UrgentSettingsRequest request, CancellationToken ct = default) =>
        await api.SendAsync<UrgentSettingsResponse>(HttpMethod.Put, "me/urgent-settings", request, AuthMode.Required, ct: ct)
        ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);

    private static string Near(double latitude, double longitude) =>
        string.Create(CultureInfo.InvariantCulture, $"{latitude:0.######},{longitude:0.######}");
}

/// <summary>
/// The saved home area is coarse on purpose: 3 decimals (about 110 m north-south), the same rounding the API
/// applies, done here before anything is sent so the precise position never leaves the phone.
/// </summary>
public static class HomeArea
{
    public const int Decimals = 3;
    public const int MinRadiusMeters = 500;
    public const int MaxRadiusMeters = 2000;
    public const int RadiusStepMeters = 250;
    public const int DefaultRadiusMeters = 1500;

    public static double Round(double value) => Math.Round(value, Decimals, MidpointRounding.AwayFromZero);

    public static CoordinateDto Round(double latitude, double longitude) => new(Round(latitude), Round(longitude));

    /// <summary>Clamps to 500..2000 m and snaps to the slider's 250 m steps.</summary>
    public static int SnapRadius(double meters)
    {
        var clamped = Math.Clamp(meters, MinRadiusMeters, MaxRadiusMeters);
        var steps = Math.Round((clamped - MinRadiusMeters) / RadiusStepMeters, MidpointRounding.AwayFromZero);
        return MinRadiusMeters + ((int)steps * RadiusStepMeters);
    }

    /// <summary>Moves a point by metres east and north (small distances, flat-earth approximation).</summary>
    public static (double Latitude, double Longitude) Offset(double latitude, double longitude, double eastMeters, double northMeters)
    {
        const double MetersPerDegree = 111_320d;
        var lat = latitude + (northMeters / MetersPerDegree);
        var lng = longitude + (eastMeters / (MetersPerDegree * Math.Cos(latitude * Math.PI / 180d)));
        return (Math.Clamp(lat, -89.9, 89.9), ((lng + 540d) % 360d) - 180d);
    }

    /// <summary>Great-circle distance in metres.</summary>
    public static double DistanceMeters(double lat1, double lng1, double lat2, double lng2)
    {
        const double EarthRadius = 6_371_000d;
        static double Rad(double degrees) => degrees * Math.PI / 180d;
        var dLat = Rad(lat2 - lat1);
        var dLng = Rad(lng2 - lng1);
        var a = (Math.Sin(dLat / 2) * Math.Sin(dLat / 2))
            + (Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2));
        return EarthRadius * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }
}

/// <summary>Turkish labels and formats for the urgent screens.</summary>
public static class UrgentText
{
    public static readonly CultureInfo Turkish = CultureInfo.GetCultureInfo("tr-TR");

    public static IReadOnlyList<string> Categories { get; } = ["Injured", "Sick", "Trapped", "Other"];

    public const string DailyCap = "Bugün en fazla 3 acil çağrı açabilirsin. Yarın yeniden açabilirsin; acil bir durumsa aşağıdaki bakım yerlerini ara.";

    public static string Category(string category) => category switch
    {
        "Injured" => "Yaralı",
        "Sick" => "Hasta",
        "Trapped" => "Sıkışmış",
        _ => "Diğer",
    };

    public static string State(string state) => state switch
    {
        "Open" => "Açık",
        "Handled" => "İlgileniliyor",
        _ => "Kapandı",
    };

    public static string Distance(double meters) => meters < 1000
        ? string.Create(Turkish, $"{Math.Max(10, Math.Round(meters / 10) * 10):0} m")
        : string.Create(Turkish, $"{meters / 1000:0.0} km");

    public static string Radius(int meters) => meters < 1000
        ? string.Create(Turkish, $"{meters} m")
        : string.Create(Turkish, $"{meters / 1000d:0.##} km");

    public static string Age(DateTimeOffset createdAt, DateTimeOffset now)
    {
        var age = now - createdAt;
        return age.TotalMinutes switch
        {
            < 1 => "az önce",
            < 60 => $"{(int)age.TotalMinutes} dk önce",
            < 60 * 24 => $"{(int)age.TotalHours} sa önce",
            _ => $"{(int)age.TotalDays} gün önce",
        };
    }

    public static string Notified(int count) => count > 0 ? $"{count} gönüllüye bildirildi" : "Yakındaki gönüllüler aranıyor";
}
