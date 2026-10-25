using Patika.App.Core.Location;

namespace Patika.App.Services.Location;

/// <summary>
/// Foreground location through MAUI Essentials. The rationale is shown in our own words before the system
/// prompt (and instead of it when the user already refused once). Fixes are returned, never kept.
/// </summary>
public sealed class MauiLocationService(TimeProvider clock) : ILocationService
{
    private static readonly TimeSpan FixTimeout = TimeSpan.FromSeconds(10);

    public async Task<LocationAccess> GetAccessAsync() =>
        Map(await MainThread.InvokeOnMainThreadAsync(Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>));

    public async Task<LocationAccess> RequestAccessAsync(string rationale)
    {
        return await MainThread.InvokeOnMainThreadAsync(async () =>
        {
            var status = await Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>();
            if (status == PermissionStatus.Granted)
            {
                return LocationAccess.Granted;
            }

            var page = Shell.Current?.CurrentPage;
            if (page is not null)
            {
                var proceed = await page.DisplayAlertAsync("Konum izni", rationale, "Devam", "Şimdi değil");
                if (!proceed)
                {
                    return LocationAccess.Denied;
                }
            }

            status = await Permissions.RequestAsync<Permissions.LocationWhenInUse>();
            if (status != PermissionStatus.Granted && !Permissions.ShouldShowRationale<Permissions.LocationWhenInUse>())
            {
                // Android stops asking after a second refusal; only Settings can grant it now.
                return LocationAccess.Blocked;
            }

            return Map(status);
        });
    }

    public async Task<GeoFix?> GetCurrentAsync(CancellationToken ct = default)
    {
        if (await GetAccessAsync() != LocationAccess.Granted)
        {
            return null;
        }

        try
        {
            var request = new GeolocationRequest(GeolocationAccuracy.Medium, FixTimeout);
            var location = await MainThread.InvokeOnMainThreadAsync(() => Geolocation.Default.GetLocationAsync(request, ct))
                ?? await Geolocation.Default.GetLastKnownLocationAsync();
            return location is null
                ? null
                : new GeoFix(location.Latitude, location.Longitude, location.Accuracy, clock.GetUtcNow());
        }
        catch (FeatureNotEnabledException)
        {
            return null;
        }
        catch (FeatureNotSupportedException)
        {
            return null;
        }
        catch (PermissionException)
        {
            return null;
        }
    }

    private static LocationAccess Map(PermissionStatus status) => status switch
    {
        PermissionStatus.Granted or PermissionStatus.Limited => LocationAccess.Granted,
        PermissionStatus.Restricted => LocationAccess.Blocked,
        PermissionStatus.Disabled => LocationAccess.Unavailable,
        _ => LocationAccess.Denied,
    };
}
