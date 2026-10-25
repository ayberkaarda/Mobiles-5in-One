using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Location;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;

namespace Patika.App.ViewModels.Map;

/// <summary>One row of the station list under the map.</summary>
public sealed record StationRow(Guid? Id, string Title, string Detail, bool IsCluster);

/// <summary>
/// Map tab core: loads the stations in the viewport from the API (single stations get their detail so the
/// list has names), caches region and details, and falls back to the cache offline (canvas "Cevrimdisi").
/// The drawn map, pins and filters are package B's; this keeps the data flow they build on.
/// </summary>
public sealed partial class MapViewModel : ViewModelBase
{
    /// <summary>Moda, Kadıköy: the area the canvas is drawn on, used until the user asks for their location.</summary>
    public static readonly MapArea DefaultArea = new(40.9790, 29.0180, 40.9930, 29.0360, 15);

    private const int DetailLimit = 20;

    private readonly PatikaApiClient api;
    private readonly MapCache cache;
    private readonly Outbox outbox;
    private readonly INetworkStatus network;
    private readonly ILocationService location;
    private readonly INavigationService navigation;
    private MapArea area = DefaultArea;
    private bool areaFromLocation;

    public MapViewModel(PatikaApiClient api, MapCache cache, Outbox outbox, INetworkStatus network,
        ILocationService location, INavigationService navigation, OutboxReplayer replayer)
    {
        this.api = api;
        this.cache = cache;
        this.outbox = outbox;
        this.network = network;
        this.location = location;
        this.navigation = navigation;
        IsOffline = !network.IsOnline;
        network.Changed += (_, online) => MainThread.BeginInvokeOnMainThread(() =>
        {
            IsOffline = !online;
            if (online)
            {
                _ = LoadAsync();
            }
        });
        outbox.Changed += (_, _) => _ = RefreshPendingAsync();
        // The first pass after start-up runs once the stored session is restored, so it also fixes the count.
        replayer.Replayed += (_, result) => MainThread.BeginInvokeOnMainThread(() =>
        {
            _ = result.Sent > 0 ? LoadAsync() : RefreshPendingAsync();
        });
    }

    public ObservableCollection<StationRow> Stations { get; } = [];

    [ObservableProperty]
    public partial bool IsOffline { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPending))]
    public partial int PendingCount { get; set; }

    /// <summary>Rejected or failed records; they stay visible until the user dismisses them in the outbox.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPending))]
    public partial int StuckCount { get; set; }

    [ObservableProperty]
    public partial string OutboxText { get; set; } = "";

    [ObservableProperty]
    public partial string Summary { get; set; } = "";

    public bool HasPending => PendingCount > 0 || StuckCount > 0;

    public async Task LoadAsync()
    {
        await RefreshPendingAsync();
        if (!network.IsOnline)
        {
            await LoadCachedAsync();
            return;
        }

        var epoch = cache.Epoch;
        var viewport = area;
        var fromLocation = areaFromLocation;
        var ok = await RunAsync(async () =>
        {
            var page = await api.GetStationsAsync(viewport);
            var details = await LoadDetailsAsync(page.Items, epoch);
            if (!fromLocation)
            {
                // A viewport centred on the user would reveal where they are; only browsed areas are kept.
                await cache.SaveRegionAsync(epoch, viewport, null, page.Items);
            }

            Show(page.Items, details, fromCache: null);
        });
        if (!ok)
        {
            await LoadCachedAsync();
        }
    }

    [RelayCommand]
    private Task RefreshAsync() => LoadAsync();

    [RelayCommand]
    private async Task LocateAsync()
    {
        var access = await location.RequestAccessAsync(LocationRationale.Map);
        if (access != LocationAccess.Granted)
        {
            ErrorMessage = access == LocationAccess.Blocked
                ? "Konum izni kapalı. Ayarlar'dan açabilirsin; harita Moda'yı göstermeye devam ediyor."
                : "Konum olmadan da haritaya bakabilirsin.";
            return;
        }

        if (await location.GetCurrentAsync() is { } fix)
        {
            // Used for this query only; neither the position nor this viewport is stored.
            area = MapArea.Around(new CoordinateDto(fix.Latitude, fix.Longitude), 1200, 15);
            areaFromLocation = true;
            await LoadAsync();
        }
    }

    [RelayCommand]
    private Task OpenStationAsync(StationRow? row) => row?.Id is { } id
        ? navigation.GoToAsync(Routes.Station, new Dictionary<string, object> { [Routes.Keys.Id] = id })
        : Task.CompletedTask;

    [RelayCommand]
    private Task OpenOutboxAsync() => navigation.GoToAsync(Routes.Outbox);

    private async Task<Dictionary<Guid, StationDetail>> LoadDetailsAsync(IReadOnlyList<MapFeature> features, long epoch)
    {
        var singles = features.Where(f => f.Id is not null).Take(DetailLimit).Select(f => f.Id!.Value).ToArray();
        var details = await Task.WhenAll(singles.Select(async id =>
        {
            try
            {
                var detail = await api.GetStationAsync(id);
                await cache.SaveStationAsync(epoch, detail);
                return detail;
            }
            catch (ApiException)
            {
                return (await cache.GetStationAsync(id))?.Detail;
            }
        }));
        return details.Where(d => d is not null).ToDictionary(d => d!.Station.Id, d => d!);
    }

    private async Task LoadCachedAsync()
    {
        var region = await cache.GetLastRegionAsync();
        if (region is null)
        {
            Stations.Clear();
            Summary = "Çevrimdışısın ve bu bölge daha önce açılmamış.";
            return;
        }

        var details = new Dictionary<Guid, StationDetail>();
        foreach (var id in region.Features.Where(f => f.Id is not null).Select(f => f.Id!.Value))
        {
            if (await cache.GetStationAsync(id) is { } cached)
            {
                details[id] = cached.Detail;
            }
        }

        Show(region.Features, details, region.SavedAt);
    }

    private void Show(IReadOnlyList<MapFeature> features, Dictionary<Guid, StationDetail> details, DateTimeOffset? fromCache)
    {
        Stations.Clear();
        foreach (var feature in features)
        {
            if (feature.Id is { } id)
            {
                var station = details.TryGetValue(id, out var d) ? d.Station : null;
                Stations.Add(new StationRow(id, station?.Name ?? "İstasyon", Describe(station), IsCluster: false));
            }
            else
            {
                Stations.Add(new StationRow(null, $"{feature.Count} istasyon", "Yakınlaştırınca ayrı ayrı görünür", IsCluster: true));
            }
        }

        var total = features.Sum(f => f.Count);
        Summary = fromCache is { } at
            ? string.Create(CultureInfo.GetCultureInfo("tr-TR"), $"{total} istasyon, {at.ToLocalTime():HH.mm} kaydı")
            : $"{total} istasyon";
    }

    private static string Describe(StationResponse? station)
    {
        if (station is null)
        {
            return "Ayrıntı için dokun";
        }

        var kind = station.Kind switch { "Water" => "Su", "Both" => "Mama ve su", _ => "Mama" };
        var fed = station.LastFedAt is { } at
            ? string.Create(CultureInfo.GetCultureInfo("tr-TR"), $"son besleme {at.ToLocalTime():d MMM HH.mm}")
            : "henüz beslenmedi";
        return station.Status == "NeedsRefill" ? $"{kind}, mama bitti" : $"{kind}, {fed}";
    }

    private async Task RefreshPendingAsync()
    {
        var owner = api.Tokens.UserId;
        var counts = owner is null ? new OutboxCounts(0, 0, null) : await outbox.CountAsync(owner);
        var text = (counts.Pending, counts.Stuck) switch
        {
            ( > 0, > 0) => $"Gönderilmeyi bekleyenler: {counts.Pending} · Gönderilemeyen: {counts.Stuck}",
            ( > 0, _) => $"Gönderilmeyi bekleyenler: {counts.Pending}",
            (_, > 0) => $"Gönderilemeyen: {counts.Stuck}. {counts.LastReason}",
            _ => "",
        };
        MainThread.BeginInvokeOnMainThread(() =>
        {
            PendingCount = counts.Pending;
            StuckCount = counts.Stuck;
            OutboxText = text;
        });
    }
}
