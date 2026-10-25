using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Offline;
using Patika.App.ViewModels.Adoption;
using Patika.Contracts.Community;

namespace Patika.App.ViewModels.Animals;

public sealed record SightingRow(SightingResponse Sighting)
{
    public string Date => Sighting.At.ToLocalTime().ToString("dd.MM HH:mm");
    public string Note => string.IsNullOrWhiteSpace(Sighting.Note) ? "Görüldü." : Sighting.Note;
}

public sealed class AnimalViewModel : AnimalFeatureViewModel
{
    private readonly PatikaApiClient api;
    private readonly Func<Guid, string?, Task<SubmitResult>> sight;
    private AnimalResponse? animal;
    private bool hasMoreSightings;
    private bool hasMorePhotos;
    private int sightingsPage;
    private int photosPage;
    public AnimalViewModel(PatikaApiClient api, FieldActions actions, INetworkStatus network)
        : this(api, (id, note) => actions.SightAsync(id, note), network) { }
    public AnimalViewModel(PatikaApiClient api, Func<Guid, string?, Task<SubmitResult>> sight, INetworkStatus network) : base(network)
    {
        this.api = api;
        this.sight = sight;
        RefreshCommand = new AsyncRelayCommand(LoadAsync);
        FollowCommand = new AsyncRelayCommand(ToggleFollowAsync);
        SightCommand = new AsyncRelayCommand(SightAsync);
        MoreSightingsCommand = new AsyncRelayCommand(() => HasMoreSightings ? ExecuteAsync(() => LoadSightingsAsync(sightingsPage + 1)) : Task.CompletedTask);
        MorePhotosCommand = new AsyncRelayCommand(() => HasMorePhotos ? ExecuteAsync(() => LoadPhotosAsync(photosPage + 1)) : Task.CompletedTask);
    }
    public Guid Id { get; set; }
    public AnimalResponse? Animal { get => animal; private set { SetProperty(ref animal, value); OnPropertyChanged(nameof(Name)); OnPropertyChanged(nameof(Species)); OnPropertyChanged(nameof(Status)); OnPropertyChanged(nameof(Health)); OnPropertyChanged(nameof(FollowText)); OnPropertyChanged(nameof(Followers)); } }
    public string Name => Animal?.Name ?? "İsimsiz dost";
    public string Species => AnimalText.Species(Animal?.Species);
    public string Status => AnimalText.Status(Animal?.Status);
    public string Health => Animal is null ? "" : AnimalText.Health(Animal.Sterilized, Animal.Vaccinated, Animal.EarTagged);
    public string FollowText => Animal?.IsFollowing == true ? "Takibi bırak" : "Takip et";
    public string Followers => $"{Animal?.FollowerCount ?? 0} takipçi";
    public string? SightingNote { get; set; }
    public ObservableCollection<AnimalPhotoResponse> Photos { get; } = [];
    public ObservableCollection<SightingRow> Sightings { get; } = [];
    public bool HasMoreSightings { get => hasMoreSightings; private set => SetProperty(ref hasMoreSightings, value); }
    public bool HasMorePhotos { get => hasMorePhotos; private set => SetProperty(ref hasMorePhotos, value); }
    public bool NoPhotos => Animal is not null && Photos.Count == 0;
    public bool NoSightings => Animal is not null && Sightings.Count == 0;
    public IAsyncRelayCommand RefreshCommand { get; }
    public IAsyncRelayCommand FollowCommand { get; }
    public IAsyncRelayCommand SightCommand { get; }
    public IAsyncRelayCommand MoreSightingsCommand { get; }
    public IAsyncRelayCommand MorePhotosCommand { get; }
    public Task LoadAsync() => ExecuteAsync(async () =>
    {
        Animal = null;
        Photos.Clear();
        Sightings.Clear();
        HasMoreSightings = HasMorePhotos = false;
        if (Id == Guid.Empty) throw new ApiException(ApiErrorKind.Client, "Hayvan bulunamadı.");
        Animal = await api.SendAsync<AnimalResponse>(HttpMethod.Get, $"animals/{Id}", null, AuthMode.Optional)
            ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);
        await LoadPhotosAsync(1);
        await LoadSightingsAsync(1);
    });
    private async Task LoadPhotosAsync(int page)
    {
        var result = await api.SendAsync<PageResponse<AnimalPhotoResponse>>(HttpMethod.Get, $"animals/{Id}/photos?page={page}&pageSize=20", null, AuthMode.Optional)
            ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);
        foreach (var photo in result.Items.Where(x => !string.IsNullOrWhiteSpace(x.PhotoUrl))) if (!Photos.Any(x => x.Id == photo.Id)) Photos.Add(photo);
        photosPage = result.Page;
        HasMorePhotos = result.HasMore;
        OnPropertyChanged(nameof(NoPhotos));
    }
    private async Task LoadSightingsAsync(int page)
    {
        var result = await api.SendAsync<PageResponse<SightingResponse>>(HttpMethod.Get, $"animals/{Id}/sightings?page={page}&pageSize=20", null, AuthMode.Optional)
            ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);
        if (page == 1) Sightings.Clear();
        foreach (var item in result.Items) if (!Sightings.Any(x => x.Sighting.Id == item.Id)) Sightings.Add(new(item));
        sightingsPage = result.Page;
        HasMoreSightings = result.HasMore;
        OnPropertyChanged(nameof(NoSightings));
    }
    public Task ToggleFollowAsync() => Animal is null ? Task.CompletedTask : ExecuteAsync(async () =>
    {
        var current = Animal;
        await api.SendAsync<object>(current.IsFollowing ? HttpMethod.Delete : HttpMethod.Put, $"animals/{Id}/follow", null, AuthMode.Required);
        Animal = current with { IsFollowing = !current.IsFollowing, FollowerCount = Math.Max(0, current.FollowerCount + (current.IsFollowing ? -1 : 1)) };
    });
    public Task SightAsync() => Animal is null ? Task.CompletedTask : ExecuteAsync(async () =>
    {
        var result = await sight(Id, SightingNote);
        Notice = result.Outcome switch
        {
            SubmitOutcome.Sent => "Görülme kaydın alındı.",
            SubmitOutcome.Queued => "Kaydın telefona kaydedildi. Bağlantı gelince gönderilecek.",
            _ => result.Message ?? "Görülme kaydı gönderilemedi."
        };
        if (result.Outcome == SubmitOutcome.Rejected) ErrorMessage = Notice;
        if (result.Outcome == SubmitOutcome.Sent) await LoadSightingsAsync(1);
    });
}
