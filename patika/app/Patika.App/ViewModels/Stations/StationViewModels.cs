using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;

namespace Patika.App.ViewModels.Stations;

/// <summary>
/// Station detail with "Beslendi" and "Mama bitti". Both go through the outbox, so they work offline and a
/// replay never doubles them. Success, cooldown and queued states are shown inline until package B adds the
/// Beslendi and Bekleme screens.
/// </summary>
public sealed partial class StationViewModel(PatikaApiClient api, MapCache cache, FieldActions actions)
    : ViewModelBase, IQueryAttributable
{
    private static readonly CultureInfo Turkish = CultureInfo.GetCultureInfo("tr-TR");

    private Guid stationId;

    public ObservableCollection<string> RecentFeedings { get; } = [];

    [ObservableProperty]
    public partial string Name { get; set; } = "İstasyon";

    [ObservableProperty]
    public partial string Detail { get; set; } = "";

    [ObservableProperty]
    public partial string? Outcome { get; set; }

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue(Routes.Keys.Id, out var value) && value is Guid id)
        {
            stationId = id;
            _ = LoadAsync();
        }
    }

    public async Task LoadAsync()
    {
        Outcome = null;
        var epoch = cache.Epoch;
        var ok = await RunAsync(async () =>
        {
            var detail = await api.GetStationAsync(stationId);
            await cache.SaveStationAsync(epoch, detail);
            Show(detail, null);
        });
        if (!ok && await cache.GetStationAsync(stationId) is { } cached)
        {
            Show(cached.Detail, cached.SavedAt);
            ErrorMessage = null;
        }
    }

    [RelayCommand]
    private Task FedAsync() => SubmitAsync(() => actions.FeedAsync(stationId, new FeedingDraft()),
        "Beslendi. Teşekkürler!");

    [RelayCommand]
    private Task EmptyAsync() => SubmitAsync(() => actions.ReportEmptyAsync(stationId),
        "Mama bitti olarak işaretlendi.");

    private async Task SubmitAsync(Func<Task<SubmitResult>> submit, string sentText)
    {
        SubmitResult? result = null;
        if (!await RunAsync(async () => result = await submit()) || result is null)
        {
            return;
        }

        Outcome = result.Outcome switch
        {
            SubmitOutcome.Sent => sentText,
            SubmitOutcome.Queued => "Çevrimdışısın. Kaydın telefonda bekliyor; bağlantı gelince gönderilecek.",
            _ => result.Message ?? ErrorMessages.Unknown,
        };
        if (result.Outcome == SubmitOutcome.Sent)
        {
            await LoadAsync();
            Outcome = sentText;
        }
    }

    private void Show(StationDetail detail, DateTimeOffset? cachedAt)
    {
        var station = detail.Station;
        Name = station.Name ?? "İstasyon";
        var kind = station.Kind switch { "Water" => "Su istasyonu", "Both" => "Mama ve su istasyonu", _ => "Mama istasyonu" };
        var species = station.Species switch { "Dog" => "köpek", "Mixed" => "kedi ve köpek", _ => "kedi" };
        Detail = string.Create(Turkish, $"{kind}, {species}. {station.FeedingsCount} besleme kaydı.")
            + (cachedAt is { } at ? string.Create(Turkish, $" Çevrimdışı kopya, {at.ToLocalTime():HH.mm}.") : "");
        RecentFeedings.Clear();
        foreach (var feeding in detail.Feedings)
        {
            RecentFeedings.Add(string.Create(Turkish, $"{feeding.At.ToLocalTime():d MMM HH.mm}") +
                (string.IsNullOrWhiteSpace(feeding.Note) ? "" : $", {feeding.Note}"));
        }
    }
}

public sealed record OutboxRow(string Time, string Title, string State, string? Reason, bool IsStuck);

/// <summary>Canvas "Cevrimdisi" sheet: what is waiting to be sent, what will not be sent and why, and "Şimdi yeniden dene".</summary>
public sealed partial class OutboxViewModel(Outbox outbox, OutboxReplayer replayer, TokenManager tokens, INetworkStatus network)
    : ViewModelBase
{
    public ObservableCollection<OutboxRow> Items { get; } = [];

    [ObservableProperty]
    public partial string Summary { get; set; } = "";

    [ObservableProperty]
    public partial bool HasStuck { get; set; }

    public async Task LoadAsync()
    {
        Items.Clear();
        if (tokens.UserId is not { } owner)
        {
            Summary = "Giriş yapınca kayıtların burada görünür.";
            HasStuck = false;
            return;
        }

        var items = await outbox.ListAsync(owner);
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
            Items.Add(new OutboxRow(item.ClientCreatedAt.ToLocalTime().ToString("HH.mm", CultureInfo.GetCultureInfo("tr-TR")),
                title, state, stuck ? item.ErrorMessage : null, stuck));
        }

        var pending = items.Count(i => i.State == OutboxState.Pending);
        HasStuck = items.Count > pending;
        Summary = pending == 0
            ? "Gönderilmeyi bekleyen kayıt yok."
            : network.IsOnline
                ? $"{pending} kayıt sırayla gönderiliyor."
                : $"{pending} kayıt bekliyor. Bağlantı gelince sırayla kendiliğinden gönderilir.";
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
}
