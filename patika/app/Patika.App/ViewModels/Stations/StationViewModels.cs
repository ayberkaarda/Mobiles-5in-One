using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Map;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;
using Patika.Contracts.Community;

namespace Patika.App.ViewModels.Stations;

/// <summary>One recent feeding (canvas "Istasyon"): the day or time on the left, who and what on the right.</summary>
public sealed record FeedingRow(string Day, string Text, string Author, bool IsMine, string? PhotoUrl)
{
    public bool HasPhoto => PhotoUrl is { Length: > 0 };
}

/// <summary>An animal seen at the station; tapping opens its profile.</summary>
public sealed record AnimalChip(Guid Id, string Name);

/// <summary>
/// Station detail (canvas "Istasyon"): photo, status chips, Beslendi and Mama bitti (both through the
/// outbox), recent feedings with who fed (the API's <c>isMine</c> and author name) and their photos,
/// and the animals seen here. Shows the cached copy when offline.
/// </summary>
public sealed partial class StationViewModel(PatikaApiClient api, MapCache cache, FieldActions actions, FeedFlow feed,
    INavigationService navigation, TimeProvider clock) : ViewModelBase, IQueryAttributable
{
    private Guid stationId;
    private StationDetail? detail;

    public ObservableCollection<FeedingRow> Feedings { get; } = [];

    public ObservableCollection<AnimalChip> Animals { get; } = [];

    [ObservableProperty]
    public partial string Name { get; set; } = "İstasyon";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasNoPhoto))]
    public partial string? PhotoUrl { get; set; }

    public bool HasNoPhoto => PhotoUrl is not { Length: > 0 };

    [ObservableProperty]
    public partial string FedChip { get; set; } = "";

    [ObservableProperty]
    public partial bool FedToday { get; set; }

    [ObservableProperty]
    public partial bool NeedsRefill { get; set; }

    [ObservableProperty]
    public partial string SpeciesChip { get; set; } = "";

    [ObservableProperty]
    public partial string KindChip { get; set; } = "";

    [ObservableProperty]
    public partial string Paragraph { get; set; } = "";

    [ObservableProperty]
    public partial string? CachedNote { get; set; }

    [ObservableProperty]
    public partial string? Outcome { get; set; }

    [ObservableProperty]
    public partial bool HasAnimals { get; set; }

    [ObservableProperty]
    public partial bool IsLoaded { get; set; }

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue(Routes.Keys.Id, out var value) && (value is Guid id || Guid.TryParse(value?.ToString(), out id)))
        {
            stationId = id;
            _ = LoadAsync();
        }
    }

    public async Task LoadAsync()
    {
        if (stationId == Guid.Empty)
        {
            return;
        }

        var epoch = cache.Epoch;
        var ok = await RunAsync(async () =>
        {
            var fresh = await api.GetStationAsync(stationId);
            await cache.SaveStationAsync(epoch, fresh);
            Show(fresh, null);
        });
        if (!ok && await cache.GetStationAsync(stationId) is { } cached)
        {
            Show(cached.Detail, cached.SavedAt);
            ErrorMessage = null;
        }

        if (ok)
        {
            await LoadAnimalsAsync();
        }
    }

    [RelayCommand]
    private Task FedAsync() => detail is { } d ? RunAsync(() => feed.FeedAsync(d, fromStationPage: true)) : Task.CompletedTask;

    [RelayCommand]
    private async Task EmptyAsync()
    {
        SubmitResult? result = null;
        if (!await RunAsync(async () => result = await actions.ReportEmptyAsync(stationId)) || result is null)
        {
            return;
        }

        Outcome = result.Outcome switch
        {
            SubmitOutcome.Sent => "Mama bitti olarak işaretlendi. Yakındaki gönüllüler haritada görecek.",
            SubmitOutcome.Queued => "Çevrimdışısın. İşaretin telefonda bekliyor; bağlantı gelince gönderilecek.",
            _ => result.Message ?? ErrorMessages.Unknown,
        };
        if (result.Outcome == SubmitOutcome.Sent)
        {
            NeedsRefill = true;
        }
    }

    [RelayCommand]
    private Task BackAsync() => navigation.GoBackAsync();

    [RelayCommand]
    private Task OpenAnimalAsync(AnimalChip? animal) => animal is null
        ? Task.CompletedTask
        : navigation.GoToAsync(Routes.Animal, new Dictionary<string, object> { [Routes.Keys.Id] = animal.Id });

    private void Show(StationDetail value, DateTimeOffset? cachedAt)
    {
        detail = value;
        var station = value.Station;
        var now = clock.GetUtcNow();
        var zone = TimeZoneInfo.Local;
        Name = StationNames.Of(station);
        PhotoUrl = station.PhotoUrl;
        FedToday = StationText.IsToday(station.LastFedAt, now, zone);
        NeedsRefill = station.Status == "NeedsRefill";
        FedChip = NeedsRefill ? "Mama bitti" : FedToday ? "Bugün beslendi" : StationText.LastFed(station.LastFedAt, now, zone);
        SpeciesChip = StationText.Species(station.Species);
        KindChip = StationText.KindChip(station.Kind);
        var last = station.LastFedAt is { } at
            ? (FedToday ? "Son besleme bugün " : "Son besleme ") + Describe(at, now, zone) + ". "
            : "Henüz besleme kaydı yok. ";
        Paragraph = last + string.Create(StationText.Turkish, $"Bu istasyonda toplam {station.FeedingsCount} besleme kaydı var.");
        CachedNote = cachedAt is { } saved ? $"Çevrimdışı kopya, {StationText.Clock(saved, zone)} kaydı." : null;

        Feedings.Clear();
        foreach (var feeding in value.Feedings)
        {
            var today = StationText.IsToday(feeding.At, now, zone);
            var note = string.IsNullOrWhiteSpace(feeding.Note) ? "Not bırakılmadı." : $"“{feeding.Note.Trim()}”";
            var text = today ? note : $"{StationText.Clock(feeding.At, zone)}. {note}";
            Feedings.Add(new FeedingRow(StationText.FeedingDay(feeding.At, now, zone), text, StationText.Author(feeding),
                feeding.IsMine, feeding.PhotoUrl));
        }

        IsLoaded = true;
    }

    private static string Describe(DateTimeOffset at, DateTimeOffset now, TimeZoneInfo zone) =>
        StationText.IsToday(at, now, zone)
            ? StationText.Clock(at, zone)
            : TimeZoneInfo.ConvertTime(at, zone).ToString("d MMMM HH.mm", StationText.Turkish);

    /// <summary>"Burada görülenler": animals registered at this station (at most six chips).</summary>
    private async Task LoadAnimalsAsync()
    {
        if (detail is null)
        {
            return;
        }

        try
        {
            var around = MapArea.Around(detail.Station.Location, 500, 19);
            var query = string.Create(CultureInfo.InvariantCulture,
                $"animals?bbox={Uri.EscapeDataString(around.ToBbox())}&zoom=19&page=1&pageSize=20&stationId={stationId:D}");
            var page = await api.SendAsync<PageResponse<MapFeature>>(HttpMethod.Get, query, null, AuthMode.Optional);
            var ids = page?.Items.Where(f => f.Id is not null).Select(f => f.Id!.Value).Take(6).ToArray() ?? [];
            var animals = await Task.WhenAll(ids.Select(async id =>
            {
                try
                {
                    return await api.SendAsync<AnimalResponse>(HttpMethod.Get, $"animals/{id:D}", null, AuthMode.Optional);
                }
                catch (ApiException)
                {
                    return null;
                }
            }));
            Animals.Clear();
            foreach (var animal in animals.OfType<AnimalResponse>())
            {
                Animals.Add(new AnimalChip(animal.Id, string.IsNullOrWhiteSpace(animal.Name) ? "İsimsiz" : animal.Name.Trim()));
            }

            HasAnimals = Animals.Count > 0;
        }
        catch (ApiException)
        {
            // The animals section is a bonus; the station itself is already on screen.
            HasAnimals = false;
        }
    }
}

/// <summary>Canvas "Beslendi": thanks, when it was recorded and when it opens again; or that it waits on the phone.</summary>
public sealed partial class FeedingDoneViewModel(INavigationService navigation, TimeProvider clock) : ViewModelBase, IQueryAttributable
{
    private FeedingVisit? visit;

    [ObservableProperty]
    public partial string Heading { get; set; } = "Beslendi. Teşekkürler.";

    [ObservableProperty]
    public partial string Body { get; set; } = "";

    [ObservableProperty]
    public partial string RecordedAt { get; set; } = "";

    [ObservableProperty]
    public partial string Again { get; set; } = "";

    [ObservableProperty]
    public partial string StationName { get; set; } = "";

    [ObservableProperty]
    public partial bool Queued { get; set; }

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (!query.TryGetValue(FeedFlow.VisitKey, out var value) || value is not FeedingVisit v)
        {
            return;
        }

        visit = v;
        var zone = TimeZoneInfo.Local;
        var now = clock.GetUtcNow();
        var opensAt = now + v.Remaining;
        StationName = v.StationName;
        Queued = v.Queued;
        Heading = v.Outcome switch
        {
            FeedOutcome.AlreadyQueued => "Kaydın zaten bekliyor.",
            FeedOutcome.Queued => "Kaydedildi. Teşekkürler.",
            _ => "Beslendi. Teşekkürler.",
        };
        Body = v.Outcome switch
        {
            FeedOutcome.AlreadyQueued => $"{v.StationName} için bir Beslendi kaydın telefonda bekliyor; ikinci bir kayıt eklenmedi. Bağlantı gelince gönderilir.",
            FeedOutcome.Queued => $"{v.StationName} için kaydın telefonda bekliyor. Bağlantı gelince gönderilir ve istasyon haritada yeşile döner.",
            _ => $"{v.StationName} haritada yeşile döndü. Bu sokağa bugün başka biri mama taşımayacak; o mama başka bir köşeye gidecek.",
        };
        RecordedAt = StationText.Clock(v.RecordedAt ?? now, zone);
        // A queued record starts the server's 30 minutes only when it arrives.
        Again = v.Queued
            ? "Gönderildikten 30 dakika sonra işaretleyebilirsin"
            : $"{StationText.Clock(opensAt, zone)}’{StationText.Ablative(TimeZoneInfo.ConvertTime(opensAt, zone))} sonra işaretleyebilirsin";
    }

    [RelayCommand]
    private Task ToMapAsync() => navigation.GoToAsync(Routes.Map);

    [RelayCommand]
    private Task ToStationAsync() => visit switch
    {
        null => navigation.GoBackAsync(),
        { FromStationPage: true } => navigation.GoBackAsync(),
        _ => navigation.GoToAsync("../" + Routes.Station, new Dictionary<string, object> { [Routes.Keys.Id] = visit.StationId }),
    };
}

/// <summary>
/// Canvas "Bekleme": the 30-minute wait, counted down from the server's answer (<c>retryAfterSeconds</c>)
/// or the last own feeding. Beslendi opens by itself when the time is up; Mama bitti stays available.
/// </summary>
public sealed partial class FeedingCooldownViewModel(FieldActions actions, FeedFlow feed, PatikaApiClient api, MapCache cache,
    CooldownBook cooldowns, INavigationService navigation, TimeProvider clock) : ViewModelBase, IQueryAttributable, IDisposable
{
    private FeedingVisit? visit;
    private ITimer? ticker;
    private long shownAt;

    [ObservableProperty]
    public partial string StationName { get; set; } = "";

    [ObservableProperty]
    public partial string FedChip { get; set; } = "";

    [ObservableProperty]
    public partial string Remaining { get; set; } = "";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(FeedAgainCommand))]
    public partial bool IsOpen { get; set; }

    [ObservableProperty]
    public partial string ButtonText { get; set; } = "Beslendi";

    [ObservableProperty]
    public partial string? Outcome { get; set; }

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (!query.TryGetValue(FeedFlow.VisitKey, out var value) || value is not FeedingVisit v)
        {
            return;
        }

        visit = v;
        shownAt = clock.GetTimestamp();
        StationName = v.StationName;
        var zone = TimeZoneInfo.Local;
        // The server counts 30 minutes from its receipt, so the feeding was at (now - (30 min - left)).
        var recorded = clock.GetUtcNow() - (CooldownBook.Window - v.Remaining);
        var fed = TimeZoneInfo.ConvertTime(recorded, zone);
        var today = StationText.IsToday(recorded, clock.GetUtcNow(), zone);
        FedChip = $"{(today ? "Bugün" : "Dün")} {StationText.Clock(recorded, zone)}’{StationText.Locative(fed)} beslendi";
        Start();
    }

    /// <summary>Counts down while the screen shows; <see cref="Dispose"/> stops it when the screen goes.</summary>
    public void Start()
    {
        Tick();
        if (!IsOpen && visit is not null && ticker is null)
        {
            ticker = clock.CreateTimer(_ => MainThread.BeginInvokeOnMainThread(Tick), null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
        }
    }

    private void Tick()
    {
        if (visit is null)
        {
            return;
        }

        // Monotonic: the book's entry, else what the screen was opened with minus the time since.
        var left = cooldowns.Remaining(api.Tokens.UserId, visit.StationId) ?? visit.Remaining - clock.GetElapsedTime(shownAt);
        IsOpen = left <= TimeSpan.Zero;
        var opensAt = clock.GetUtcNow() + (IsOpen ? TimeSpan.Zero : left);
        var zone = TimeZoneInfo.Local;
        var minutes = (int)Math.Ceiling(left.TotalMinutes);
        Remaining = IsOpen ? "Şimdi" : string.Create(StationText.Turkish, $"{minutes} dk");
        ButtonText = IsOpen
            ? "Beslendi"
            : $"Beslendi, {StationText.Clock(opensAt, zone)}’{StationText.Locative(TimeZoneInfo.ConvertTime(opensAt, zone))} açılır";
        if (IsOpen)
        {
            ticker?.Dispose();
            ticker = null;
        }
    }

    [RelayCommand(CanExecute = nameof(IsOpen))]
    private async Task FeedAgainAsync()
    {
        if (visit is null)
        {
            return;
        }

        await RunAsync(async () =>
        {
            var current = (await cache.GetStationAsync(visit.StationId))?.Detail;
            var detail = current ?? await api.GetStationAsync(visit.StationId);
            await feed.FeedAsync(detail, visit.FromStationPage, replace: true);
        });
    }

    [RelayCommand]
    private async Task EmptyAsync()
    {
        if (visit is null)
        {
            return;
        }

        SubmitResult? result = null;
        if (await RunAsync(async () => result = await actions.ReportEmptyAsync(visit.StationId)) && result is not null)
        {
            Outcome = result.Outcome switch
            {
                SubmitOutcome.Sent => "Mama bitti olarak işaretlendi.",
                SubmitOutcome.Queued => "İşaretin telefonda bekliyor; bağlantı gelince gönderilecek.",
                _ => result.Message ?? ErrorMessages.Unknown,
            };
        }
    }

    [RelayCommand]
    private Task BackAsync() => navigation.GoBackAsync();

    public void Dispose()
    {
        ticker?.Dispose();
        ticker = null;
    }
}

public sealed record OutboxRow(string Time, string Title, string Target, string State, bool IsRetry, bool IsStuck, string? Reason);

/// <summary>
/// Canvas "Cevrimdisi": the offline banner, what waits to be sent in order, what will not be sent and why,
/// "Şimdi yeniden dene" and clearing the refused ones once read.
/// </summary>
public sealed partial class OutboxViewModel(Outbox outbox, OutboxReplayer replayer, TokenManager tokens, INetworkStatus network,
    MapCache cache, INavigationService navigation) : ViewModelBase
{
    public ObservableCollection<OutboxRow> Items { get; } = [];

    [ObservableProperty]
    public partial string Summary { get; set; } = "";

    [ObservableProperty]
    public partial int PendingCount { get; set; }

    [ObservableProperty]
    public partial bool HasStuck { get; set; }

    [ObservableProperty]
    public partial bool IsOffline { get; set; }

    [ObservableProperty]
    public partial bool IsEmpty { get; set; }

    public async Task LoadAsync()
    {
        IsOffline = !network.IsOnline;
        if (tokens.UserId is not { } owner)
        {
            Items.Clear();
            Summary = "Giriş yapınca kayıtların burada görünür.";
            HasStuck = false;
            IsEmpty = true;
            return;
        }

        var items = await outbox.ListAsync(owner);
        var rows = new List<OutboxRow>(items.Count);
        foreach (var item in items)
        {
            var title = item.Kind switch
            {
                OutboxKinds.Feeding => "Beslendi",
                OutboxKinds.NeedsRefill => "Mama bitti",
                OutboxKinds.Sighting => "Görüldü",
                _ => item.Kind,
            };
            var stuck = item.State != OutboxState.Pending;
            var state = stuck ? "Gönderilemedi" : item.Attempts > 0 ? "Tekrar denenecek" : "Bekliyor";
            rows.Add(new OutboxRow(StationText.Clock(item.ClientCreatedAt, TimeZoneInfo.Local), title, await TargetAsync(item),
                state, !stuck && item.Attempts > 0, stuck, stuck ? item.ErrorMessage : null));
        }

        Items.Clear();
        foreach (var row in rows)
        {
            Items.Add(row);
        }

        var pending = items.Count(i => i.State == OutboxState.Pending);
        PendingCount = pending;
        HasStuck = items.Count > pending;
        IsEmpty = items.Count == 0;
        Summary = pending == 0
            ? "Gönderilmeyi bekleyen kayıt yok."
            : network.IsOnline
                ? "Bağlantı var; kayıtlar sırayla gönderiliyor."
                : "Bağlantı gelince sırayla kendiliğinden gönderilir.";
    }

    private async Task<string> TargetAsync(OutboxItem item)
    {
        if (item.Kind is OutboxKinds.Feeding or OutboxKinds.NeedsRefill && Guid.TryParse(item.TargetId, out var id)
            && await cache.GetStationAsync(id) is { } cached)
        {
            return StationNames.Of(cached.Detail.Station);
        }

        return item.Kind == OutboxKinds.Sighting ? "hayvan kaydı" : "istasyon";
    }

    [RelayCommand]
    private async Task RetryNowAsync()
    {
        if (tokens.UserId is { } owner)
        {
            await outbox.RetryNowAsync(owner);
            await replayer.ReplayAsync();
        }

        await LoadAsync();
    }

    /// <summary>"Gönderilemeyenleri temizle": the user has read the reasons.</summary>
    [RelayCommand]
    private async Task DismissStuckAsync()
    {
        if (tokens.UserId is { } owner)
        {
            await outbox.DismissStuckAsync(owner);
        }

        await LoadAsync();
    }

    [RelayCommand]
    private Task BackAsync() => navigation.GoBackAsync();
}
