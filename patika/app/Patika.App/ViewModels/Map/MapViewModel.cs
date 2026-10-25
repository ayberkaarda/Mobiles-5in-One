using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Location;
using Patika.App.Core.Map;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;
using Patika.App.Drawing;
using Patika.App.ViewModels.Stations;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;

namespace Patika.App.ViewModels.Map;

/// <summary>One row of the list under the map (the accessible twin of the pins).</summary>
public sealed record StationRow(MapPin Pin, string Title, string Detail);

/// <summary>
/// Map tab (canvas "Main" and "Cevrimdisi"): server clusters and stations for the visible area and filter,
/// the selected station's sheet with Beslendi, the outbox counter and the offline banner. Loads after every
/// gesture that leaves the fetched area; falls back to the cached last region offline.
/// </summary>
public sealed partial class MapViewModel : ViewModelBase
{
    /// <summary>Details fetched per load so single pins get their colour; the rest stay grey until tapped.</summary>
    private const int DetailLimit = 24;

    private static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(350);

    private readonly PatikaApiClient api;
    private readonly MapCache cache;
    private readonly Outbox outbox;
    private readonly INetworkStatus network;
    private readonly ILocationService location;
    private readonly INavigationService navigation;
    private readonly FeedFlow feed;
    private readonly TimeProvider clock;
    private readonly Dictionary<Guid, StationDetail> details = [];
    private IReadOnlyList<MapFeature> features = [];
    private MapArea? fetched;
    private StationFilter fetchedFilter = StationFilter.All;
    private CancellationTokenSource? pending;
    private long generation;
    private bool viewportFromLocation;
    private bool restoredRegion;
    private Guid? selectedId;

    public MapViewModel(PatikaApiClient api, MapCache cache, Outbox outbox, INetworkStatus network,
        ILocationService location, INavigationService navigation, OutboxReplayer replayer, FeedFlow feed,
        CooldownBook cooldowns, TimeProvider clock)
    {
        this.api = api;
        this.cache = cache;
        this.outbox = outbox;
        this.network = network;
        this.location = location;
        this.navigation = navigation;
        this.feed = feed;
        this.clock = clock;
        IsOffline = !network.IsOnline;
        network.Changed += (_, online) => MainThread.BeginInvokeOnMainThread(() =>
        {
            IsOffline = !online;
            _ = LoadAsync(force: true);
        });
        outbox.Changed += (_, _) => _ = RefreshPendingAsync();
        replayer.Replayed += (_, result) => MainThread.BeginInvokeOnMainThread(() =>
        {
            _ = result.Sent > 0 ? LoadAsync(force: true) : RefreshPendingAsync();
        });
        cooldowns.Changed += (_, _) => MainThread.BeginInvokeOnMainThread(() => OnPropertyChanged(nameof(Selected)));
    }

    [ObservableProperty]
    public partial MapViewport Viewport { get; set; } = MapViewport.Default();

    [ObservableProperty]
    public partial IReadOnlyList<MapPin> Pins { get; set; } = [];

    /// <summary>Only after "Konumuma git", in memory, for the blue dot.</summary>
    [ObservableProperty]
    public partial GeoPoint? UserLocation { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsAllOn), nameof(IsCatOn), nameof(IsDogOn), nameof(IsFoodOn), nameof(IsWaterOn), nameof(IsRefillOn))]
    public partial StationFilter Filter { get; set; } = StationFilter.All;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSelection), nameof(HasNoSelection))]
    public partial StationCard? Selected { get; set; }

    [ObservableProperty]
    public partial bool IsOffline { get; set; }

    /// <summary>Fetching the area; separate from IsBusy so Beslendi stays usable while pins load.</summary>
    [ObservableProperty]
    public partial bool IsLoading { get; set; }

    [ObservableProperty]
    public partial bool IsListOpen { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPending))]
    public partial int PendingCount { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPending))]
    public partial int StuckCount { get; set; }

    [ObservableProperty]
    public partial string OutboxText { get; set; } = "";

    [ObservableProperty]
    public partial string Summary { get; set; } = "";

    [ObservableProperty]
    public partial string AreaTitle { get; set; } = "Harita";

    public ObservableCollection<StationRow> Rows { get; } = [];

    public bool HasSelection => Selected is not null;

    public bool HasNoSelection => Selected is null;

    public bool HasPending => PendingCount > 0 || StuckCount > 0;

    public bool IsAllOn => Filter.IsOn(FilterChip.All);

    public bool IsCatOn => Filter.IsOn(FilterChip.Cat);

    public bool IsDogOn => Filter.IsOn(FilterChip.Dog);

    public bool IsFoodOn => Filter.IsOn(FilterChip.Food);

    public bool IsWaterOn => Filter.IsOn(FilterChip.Water);

    public bool IsRefillOn => Filter.IsOn(FilterChip.NeedsRefill);

    /// <summary>The current viewport, for "İstasyon ekle" to start where the user is looking.</summary>
    public MapViewport CurrentViewport => Viewport;

    public async Task LoadAsync(bool force = false)
    {
        await RefreshPendingAsync();
        if (!network.IsOnline)
        {
            await LoadCachedAsync();
            return;
        }

        var viewport = Viewport;
        // Centred on the user: ask for whole grid cells, so the request does not carry their position.
        var area = viewportFromLocation ? CoarseArea.Around(viewport.Latitude, viewport.Longitude, viewport) : viewport.ToArea();
        if (!force && fetched is not null && fetchedFilter == Filter && viewport.IsCoveredBy(fetched))
        {
            return;
        }

        var run = Interlocked.Increment(ref generation);
        var filter = Filter;
        var epoch = cache.Epoch;
        var fromLocation = viewportFromLocation;
        IsLoading = true;
        try
        {
            var page = await api.GetStationsAsync(area, filter.ToQuery());
            if (run != Interlocked.Read(ref generation))
            {
                return; // a newer gesture already asked for another area
            }

            ErrorMessage = null;
            features = page.Items;
            fetched = area;
            fetchedFilter = filter;
            if (!fromLocation)
            {
                // A viewport the user's position led to would reveal where they are; only browsed areas are kept.
                await cache.SaveRegionAsync(epoch, area, filter.ToQuery(), page.Items);
            }

            Show(fromCache: null);
            await LoadDetailsAsync(page.Items, epoch, run);
        }
        catch (ApiException e)
        {
            if (run == Interlocked.Read(ref generation))
            {
                ErrorMessage = e.Message;
                if (features.Count == 0)
                {
                    await LoadCachedAsync();
                }
            }
        }
        finally
        {
            if (run == Interlocked.Read(ref generation))
            {
                IsLoading = false;
            }
        }
    }

    /// <summary>Each time the tab shows: refresh the selected card and the area (a feeding may have turned a pin green).</summary>
    public async Task AppearAsync()
    {
        if (Selected is { } card)
        {
            await SelectAsync(card.Id, refresh: true);
        }

        await LoadAsync(force: true);
    }

    /// <summary>The add-station screen hands back what it created, so the new pin shows at once.</summary>
    public void ShowCreated(StationResponse station)
    {
        details[station.Id] = new StationDetail(station, []);
        Viewport = Viewport.CenterOn(station.Location.Latitude, station.Location.Longitude, Math.Max(Viewport.Zoom, 16));
        Select(station.Id);
        _ = LoadAsync(force: true);
    }

    [RelayCommand]
    private void Settled(MapViewport? viewport)
    {
        if (viewport is null)
        {
            return;
        }

        Viewport = viewport;
        pending?.Cancel();
        var cts = pending = new CancellationTokenSource();
        _ = Task.Delay(Debounce, cts.Token).ContinueWith(t =>
        {
            if (!t.IsCanceled)
            {
                MainThread.BeginInvokeOnMainThread(() => _ = LoadAsync());
            }
        }, TaskScheduler.Default);
    }

    [RelayCommand]
    private Task PinTappedAsync(MapPin? pin)
    {
        if (pin is null)
        {
            return Task.CompletedTask;
        }

        if (pin.Kind == PinKind.Cluster || pin.Id is null)
        {
            Viewport = MapScene.ZoomInto(Viewport, pin);
            return LoadAsync();
        }

        return SelectAsync(pin.Id.Value);
    }

    [RelayCommand]
    private void Deselect()
    {
        Selected = null;
        selectedId = null;
        Show(fromCache: null);
    }

    /// <summary>"Listeye dön": leave the selected station for the list, without having to find empty map.</summary>
    [RelayCommand]
    private void BackToList()
    {
        Deselect();
        IsListOpen = true;
    }

    [RelayCommand]
    private Task FilterAsync(FilterChip chip)
    {
        Filter = Filter.Toggle(chip);
        Selected = null;
        selectedId = null;
        return LoadAsync(force: true);
    }

    [RelayCommand]
    private void ToggleList() => IsListOpen = !IsListOpen;

    [RelayCommand]
    private async Task LocateAsync()
    {
        var access = await location.RequestAccessAsync(LocationRationale.Map);
        if (access != LocationAccess.Granted)
        {
            ErrorMessage = access == LocationAccess.Blocked
                ? "Konum izni kapalı. Ayarlar'dan açabilirsin; harita kaldığın yeri göstermeye devam ediyor."
                : "Konum olmadan da haritayı kaydırarak bakabilirsin.";
            return;
        }

        if (await location.GetCurrentAsync() is { } fix)
        {
            // Used for this view only: the dot and the viewport live in memory, this area is never cached.
            viewportFromLocation = true;
            UserLocation = new GeoPoint(fix.Latitude, fix.Longitude);
            Viewport = Viewport.CenterOn(fix.Latitude, fix.Longitude, Math.Max(Viewport.Zoom, 15.5));
            await LoadAsync(force: true);
        }
        else
        {
            ErrorMessage = "Konumun şu an alınamadı. Haritayı kaydırarak devam edebilirsin.";
        }
    }

    [RelayCommand]
    private Task FeedAsync() => Selected is { } card
        ? RunAsync(() => feed.FeedAsync(card.Detail, fromStationPage: false))
        : Task.CompletedTask;

    [RelayCommand]
    private Task OpenDetailsAsync() => Selected is { } card
        ? navigation.GoToAsync(Routes.Station, new Dictionary<string, object> { [Routes.Keys.Id] = card.Id })
        : Task.CompletedTask;

    [RelayCommand]
    private Task OpenRowAsync(StationRow? row) => row is null ? Task.CompletedTask : PinTappedAsync(row.Pin);

    [RelayCommand]
    private Task AddStationAsync() => navigation.GoToAsync(Routes.AddStation);

    [RelayCommand]
    private Task OpenOutboxAsync() => navigation.GoToAsync(Routes.Outbox);

    private async Task SelectAsync(Guid id, bool refresh = false)
    {
        Select(id);
        if (!refresh && details.ContainsKey(id) && Selected?.Detail.Feedings.Count > 0)
        {
            return;
        }

        try
        {
            var epoch = cache.Epoch;
            var detail = await api.GetStationAsync(id);
            await cache.SaveStationAsync(epoch, detail);
            details[id] = detail;
        }
        catch (ApiException e)
        {
            if (await cache.GetStationAsync(id) is { } cached)
            {
                details[id] = cached.Detail;
            }
            else
            {
                ErrorMessage = e.Message;
            }
        }

        if (selectedId == id)
        {
            Select(id);
        }
    }

    private void Select(Guid id)
    {
        selectedId = id;
        Selected = details.TryGetValue(id, out var detail) ? StationCard.From(detail, clock.GetUtcNow()) : null;
        IsListOpen = false;
        Show(fromCache: null);
    }

    private async Task LoadDetailsAsync(IReadOnlyList<MapFeature> items, long epoch, long run)
    {
        var missing = items.Where(f => f.Id is { } id && !details.ContainsKey(id)).Take(DetailLimit)
            .Select(f => f.Id!.Value).ToArray();
        if (missing.Length == 0)
        {
            return;
        }

        using var gate = new SemaphoreSlim(6);
        var loaded = await Task.WhenAll(missing.Select(async id =>
        {
            await gate.WaitAsync();
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
            finally
            {
                gate.Release();
            }
        }));
        foreach (var detail in loaded.OfType<StationDetail>())
        {
            details[detail.Station.Id] = detail;
        }

        if (run == Interlocked.Read(ref generation))
        {
            Show(fromCache: null);
        }
    }

    private async Task LoadCachedAsync()
    {
        var region = await cache.GetLastRegionAsync();
        if (region is null)
        {
            features = [];
            Show(fromCache: null);
            Summary = "Çevrimdışısın ve bu bölge daha önce açılmamış.";
            return;
        }

        foreach (var id in region.Features.Where(f => f.Id is not null).Select(f => f.Id!.Value))
        {
            if (!details.ContainsKey(id) && await cache.GetStationAsync(id) is { } cached)
            {
                details[id] = cached.Detail;
            }
        }

        if (!restoredRegion && !viewportFromLocation)
        {
            // First start without a connection: look where the user last looked.
            restoredRegion = true;
            var area = region.Area;
            Viewport = Viewport.CenterOn((area.MinLatitude + area.MaxLatitude) / 2, (area.MinLongitude + area.MaxLongitude) / 2,
                Math.Max(MapViewport.MinZoom, area.Zoom + 0.5));
        }

        features = region.Features;
        fetched = null;
        Show(region.SavedAt);
    }

    private void Show(DateTimeOffset? fromCache)
    {
        var now = clock.GetUtcNow();
        var stations = details.ToDictionary(d => d.Key, d => d.Value.Station);
        Pins = MapScene.Build(features, stations, selectedId, now, TimeZoneInfo.Local);

        Rows.Clear();
        foreach (var pin in Pins.Where(p => p.Kind != PinKind.Cluster))
        {
            var station = pin.Id is { } id && stations.TryGetValue(id, out var s) ? s : null;
            Rows.Add(new StationRow(pin, station?.Name ?? "İstasyon",
                station is null ? "Ayrıntı için dokun" : StationText.LastFed(station.LastFedAt, now, TimeZoneInfo.Local)));
        }

        foreach (var pin in Pins.Where(p => p.Kind == PinKind.Cluster))
        {
            Rows.Add(new StationRow(pin, $"{pin.Count} istasyon", "Yakınlaştırmak için dokun"));
        }

        var total = features.Sum(f => f.Count);
        var district = Selected?.District ?? stations.Values.Select(s => s.District).FirstOrDefault(d => !string.IsNullOrWhiteSpace(d));
        AreaTitle = string.IsNullOrWhiteSpace(district) ? "Harita" : district;
        Summary = fromCache is { } at
            ? $"{total} istasyon, {StationText.Clock(at, TimeZoneInfo.Local)} kaydı"
            : total == 0 ? "Bu bölgede istasyon yok" : $"{total} istasyon";
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
