using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;
using Patika.Contracts.Adoptions;
using Patika.Contracts.Community;

namespace Patika.App.ViewModels.Adoption;

public static class AnimalText
{
    public static string Species(string? value) => value switch { "Cat" => "Kedi", "Dog" => "Köpek", _ => "Diğer" };
    public static string Status(string? value) => value switch
    {
        "Healthy" => "Sağlıklı",
        "Injured" => "Yaralı",
        "Sick" => "Hasta",
        "Adopted" => "Sahiplenildi",
        "Missing" => "Kayıp",
        "Deceased" => "Hayatını kaybetti",
        "Published" => "Yayında",
        "Pending" => "Bekliyor",
        "Accepted" => "Kabul edildi",
        "Rejected" => "Reddedildi",
        "Closed" => "Kapandı",
        "Replied" => "Yanıtlandı",
        _ => "Durum bilgisi yok"
    };
    public static string Health(bool sterilized, bool vaccinated, bool earTagged) =>
        $"{(sterilized ? "Kısırlaştırıldı" : "Kısırlaştırma bilgisi yok")} · {(vaccinated ? "Aşılı" : "Aşı bilgisi yok")} · {(earTagged ? "Kulak küpeli" : "Küpesiz")}";
}

public abstract class AnimalFeatureViewModel(INetworkStatus network) : ViewModelBase
{
    private bool observing;
    public bool IsOffline => !network.IsOnline;
    public void Activate()
    {
        if (!observing) network.Changed += ConnectivityChanged;
        observing = true;
        OnPropertyChanged(nameof(IsOffline));
    }
    public void Deactivate()
    {
        network.Changed -= ConnectivityChanged;
        observing = false;
    }
    private void ConnectivityChanged(object? sender, bool online) => OnPropertyChanged(nameof(IsOffline));
    private string? notice;
    public string? Notice { get => notice; protected set => SetProperty(ref notice, value); }
    protected async Task ExecuteAsync(Func<Task> action)
    {
        await RunAsync(action);
        OnPropertyChanged(nameof(IsOffline));
        OnPropertyChanged(nameof(IsEmpty));
    }
    public virtual bool IsEmpty => false;
}

public sealed record AdoptionCard(AdoptionPostResponse Post)
{
    public Guid Id => Post.Id;
    public string Name => string.IsNullOrWhiteSpace(Post.AnimalName) ? "İsimsiz dost" : Post.AnimalName;
    public string Species => AnimalText.Species(Post.Species);
    public string Status => AnimalText.Status(Post.Status);
    public string District => Post.District;
    public string? PhotoUrl => Post.FirstPhotoUrl;
    public bool HasPhoto => !string.IsNullOrWhiteSpace(PhotoUrl);
    public string Health => AnimalText.Health(Post.Sterilized, Post.Vaccinated, Post.EarTagged);
    public string Closing => $"{Math.Max(0, (int)Math.Ceiling((Post.ClosesAt - DateTimeOffset.UtcNow).TotalDays))} gün kaldı";
}

public sealed class AdoptViewModel : AnimalFeatureViewModel
{
    private readonly PatikaApiClient api;
    private readonly INavigationService navigation;
    private int page;
    private bool hasMore;
    private bool loaded;
    private string district = "";
    private string species = "Hepsi";
    public AdoptViewModel(PatikaApiClient api, INavigationService navigation, INetworkStatus network) : base(network)
    {
        this.api = api;
        this.navigation = navigation;
        RefreshCommand = new AsyncRelayCommand(RefreshAsync);
        MoreCommand = new AsyncRelayCommand(LoadMoreAsync);
        OpenCommand = new AsyncRelayCommand<AdoptionCard>(card => card is null ? Task.CompletedTask : navigation.GoToAsync(Routes.AdoptionPost, new Dictionary<string, object> { [Routes.Keys.Id] = card.Id }));
        RequestsCommand = new AsyncRelayCommand(() => navigation.GoToAsync("taleplerim"));
    }
    public ObservableCollection<AdoptionCard> Items { get; } = [];
    public string District { get => district; set { if (SetProperty(ref district, value)) HasMore = false; } }
    public string Species { get => species; set { if (SetProperty(ref species, value)) HasMore = false; } }
    public bool HasMore { get => hasMore; private set => SetProperty(ref hasMore, value); }
    public override bool IsEmpty => loaded && Items.Count == 0 && !IsBusy && !HasError;
    public IAsyncRelayCommand RefreshCommand { get; }
    public IAsyncRelayCommand MoreCommand { get; }
    public IAsyncRelayCommand<AdoptionCard> OpenCommand { get; }
    public IAsyncRelayCommand RequestsCommand { get; }
    public Task RefreshAsync() => LoadAsync(true);
    public Task LoadMoreAsync() => HasMore ? LoadAsync(false) : Task.CompletedTask;
    private Task LoadAsync(bool reset) => ExecuteAsync(async () =>
    {
        var next = reset ? 1 : page + 1;
        var path = $"adoptions?page={next}&pageSize=20";
        if (!string.IsNullOrWhiteSpace(District)) path += "&district=" + Uri.EscapeDataString(District.Trim());
        if (Species != "Hepsi") path += "&species=" + (Species == "Kedi" ? "Cat" : "Dog");
        var rows = await api.SendAsync<AdoptionPostResponse[]>(HttpMethod.Get, path, null, AuthMode.Optional)
            ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);
        if (reset) Items.Clear();
        foreach (var row in rows) if (!Items.Any(x => x.Id == row.Id)) Items.Add(new(row));
        page = next;
        HasMore = rows.Length == 20;
        loaded = true;
    });
}

public sealed class AdoptionPostViewModel : AnimalFeatureViewModel
{
    private readonly PatikaApiClient api;
    private readonly INavigationService navigation;
    private AdoptionCard? card;
    public AdoptionPostViewModel(PatikaApiClient api, INavigationService navigation, INetworkStatus network) : base(network)
    {
        this.api = api;
        this.navigation = navigation;
        RefreshCommand = new AsyncRelayCommand(LoadAsync);
        RequestCommand = new AsyncRelayCommand(() => Card is null || !CanRequest ? Task.CompletedTask : navigation.GoToAsync(Routes.AdoptionRequest, new Dictionary<string, object> { [Routes.Keys.Id] = Id }));
        ProfileCommand = new AsyncRelayCommand(() => Card is null ? Task.CompletedTask : navigation.GoToAsync(Routes.Animal, new Dictionary<string, object> { [Routes.Keys.Id] = Card.Post.AnimalId }));
    }
    public Guid Id { get; set; }
    public AdoptionCard? Card { get => card; private set { SetProperty(ref card, value); OnPropertyChanged(nameof(CanRequest)); OnPropertyChanged(nameof(Closing)); } }
    public bool CanRequest => Card is not null && Card.Post.State == "Published" && Card.Post.Status != "Adopted" && Card.Post.ClosesAt > DateTimeOffset.UtcNow && !IsBusy;
    public string Closing => Card is null ? "" : $"İlan {Card.Post.ClosesAt.ToLocalTime():dd.MM.yyyy} tarihinde kapanır. Talebini yalnızca ilan sahibi ve moderatörler görür.";
    public IAsyncRelayCommand RefreshCommand { get; }
    public IAsyncRelayCommand RequestCommand { get; }
    public IAsyncRelayCommand ProfileCommand { get; }
    public async Task LoadAsync()
    {
        await ExecuteAsync(async () =>
        {
            Card = null;
            if (Id == Guid.Empty) throw new ApiException(ApiErrorKind.Client, "İlan bulunamadı.");
            Card = new(await api.SendAsync<AdoptionPostResponse>(HttpMethod.Get, $"adoptions/{Id}", null, AuthMode.Optional)
                ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server));
        });
        OnPropertyChanged(nameof(CanRequest));
    }
}

public sealed class AdoptionRequestViewModel : AnimalFeatureViewModel
{
    private readonly PatikaApiClient api;
    private string message = "";
    private string? validationMessage;
    private bool succeeded;
    private string requestKey = Guid.NewGuid().ToString();
    public AdoptionRequestViewModel(PatikaApiClient api, INavigationService navigation, INetworkStatus network) : base(network)
    {
        this.api = api;
        SubmitCommand = new AsyncRelayCommand(SubmitAsync);
        RequestsCommand = new AsyncRelayCommand(() => navigation.GoToAsync("taleplerim"));
    }
    public Guid Id { get; set; }
    public string Message { get => message; set { if (SetProperty(ref message, value ?? "")) { OnPropertyChanged(nameof(CharacterCount)); ValidationMessage = null; requestKey = Guid.NewGuid().ToString(); } } }
    public string CharacterCount => $"{Message.Length} / 3000";
    public string? ValidationMessage { get => validationMessage; private set => SetProperty(ref validationMessage, value); }
    public bool Succeeded { get => succeeded; private set { SetProperty(ref succeeded, value); OnPropertyChanged(nameof(ShowForm)); } }
    public bool ShowForm => !Succeeded;
    public IAsyncRelayCommand SubmitCommand { get; }
    public IAsyncRelayCommand RequestsCommand { get; }
    public Task SubmitAsync()
    {
        if (Succeeded || IsBusy) return Task.CompletedTask;
        ValidationMessage = string.IsNullOrWhiteSpace(Message) ? "Lütfen kendini ve evini anlat." : Message.Length > 3000 ? "Mesaj en fazla 3000 karakter olabilir." : Id == Guid.Empty ? "İlan bulunamadı. İlanı yeniden aç." : null;
        if (ValidationMessage is not null) return Task.CompletedTask;
        return ExecuteAsync(async () =>
        {
            var response = await api.SendAsync<AdoptionRequestResponse>(HttpMethod.Post, $"adoptions/{Id}/requests", new CreateAdoptionRequest(Message.Trim()), AuthMode.Required, requestKey);
            if (response is null) throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);
            Succeeded = true;
            Notice = "Talebin gönderildi. Yanıtını Taleplerim ekranından takip edebilirsin.";
        });
    }
}

public sealed record RequestCard(AdoptionRequestResponse Request)
{
    public string Message => Request.Message;
    public string State => AnimalText.Status(Request.State);
    public string Reply => string.IsNullOrWhiteSpace(Request.Reply) ? "Henüz yanıt gelmedi." : Request.Reply;
}

public sealed class MyAdoptionRequestsViewModel : AnimalFeatureViewModel
{
    private readonly PatikaApiClient api;
    private int page;
    private bool loaded;
    private bool hasMore;
    public MyAdoptionRequestsViewModel(PatikaApiClient api, INetworkStatus network) : base(network)
    {
        this.api = api;
        RefreshCommand = new AsyncRelayCommand(RefreshAsync);
        MoreCommand = new AsyncRelayCommand(() => HasMore ? LoadAsync(false) : Task.CompletedTask);
    }
    public ObservableCollection<RequestCard> Items { get; } = [];
    public bool HasMore { get => hasMore; private set => SetProperty(ref hasMore, value); }
    public override bool IsEmpty => loaded && Items.Count == 0 && !IsBusy && !HasError;
    public IAsyncRelayCommand RefreshCommand { get; }
    public IAsyncRelayCommand MoreCommand { get; }
    public Task RefreshAsync() => LoadAsync(true);
    private Task LoadAsync(bool reset) => ExecuteAsync(async () =>
    {
        var next = reset ? 1 : page + 1;
        var result = await api.SendAsync<PageResponse<AdoptionRequestResponse>>(HttpMethod.Get, $"me/adoption-requests?page={next}&pageSize=20", null, AuthMode.Required)
            ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);
        if (reset) Items.Clear();
        foreach (var item in result.Items) if (!Items.Any(x => x.Request.Id == item.Id)) Items.Add(new(item));
        page = result.Page;
        HasMore = result.HasMore;
        loaded = true;
    });
}
