using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Location;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.App.Core.Push;
using Patika.App.ViewModels.Account;
using Patika.Contracts.CarePlaces;
using Patika.Contracts.Geo;
using Patika.Contracts.Urgent;

namespace Patika.App.ViewModels.Urgent;

/// <summary>A photo taken for an urgent post, already stripped of its location and uploaded.</summary>
public sealed record UrgentPhoto(string Key, string? PreviewPath);

/// <summary>Takes a photo, strips its metadata and uploads it as an <c>urgent</c> photo. The app adapts the media uploader.</summary>
public interface IUrgentPhotoFlow
{
    /// <summary>The uploaded photo, or null when the user cancelled the camera.</summary>
    Task<UrgentPhoto?> CaptureAsync(CancellationToken ct = default);
}

public sealed record UrgentRow(UrgentPostResponse Post, string Category, string Distance, string Age, string Notified)
{
    public Guid Id => Post.Id;

    public string Description => Post.Description;

    public string? PhotoUrl => Post.PhotoUrl;

    public bool HasPhoto => Post.PhotoUrl is not null;

    /// <summary>Injured posts get the red chip; the others the light one.</summary>
    public bool IsInjured => Post.Category == "Injured";

    public static UrgentRow From(UrgentPostResponse post, double? fromLatitude, double? fromLongitude, DateTimeOffset now)
    {
        double? meters = post.DistanceMeters;
        if (meters is null && fromLatitude is { } lat && fromLongitude is { } lng)
        {
            meters = HomeArea.DistanceMeters(lat, lng, post.Location.Latitude, post.Location.Longitude);
        }

        return new UrgentRow(post, UrgentText.Category(post.Category), meters is { } m ? UrgentText.Distance(m) : "",
            UrgentText.Age(post.CreatedAt, now), UrgentText.Notified(post.NotifiedCount));
    }
}

public sealed record CarePlaceRow(CarePlaceResponse Place, string Distance)
{
    public string Name => Place.Name;

    public string Hours => Place.Open24h ? "24 saat açık" : Place.Address;

    public bool IsOpen24h => Place.Open24h;

    public bool HasPhone => Place.Phone is { Length: > 0 };

    public bool IsSample => Place.IsSample;

    public string CallDescription => $"{Place.Name} ara";

    public static CarePlaceRow From(CarePlaceResponse place, double latitude, double longitude) =>
        new(place, UrgentText.Distance(HomeArea.DistanceMeters(latitude, longitude, place.Latitude, place.Longitude)));
}

public enum UrgentListState
{
    Loading,

    /// <summary>Location is off or not granted; the list needs a position to search around.</summary>
    NeedsLocation,

    Ready,

    Failed,
}

/// <summary>
/// Canvas "Acil": open urgent posts within 2 km and the nearest care places. The position is read once per
/// load for the query and kept only in memory.
/// </summary>
public sealed partial class UrgentListViewModel(
    UrgentApi api, ILocationService location, INavigationService navigation, IAppLauncher launcher, TimeProvider clock)
    : ViewModelBase
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsLoading), nameof(NeedsLocation), nameof(IsReady), nameof(IsEmpty))]
    public partial UrgentListState State { get; set; } = UrgentListState.Loading;

    [ObservableProperty]
    public partial string LocationNote { get; set; } = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasCarePlaces))]
    public partial int CarePlaceCount { get; set; }

    public ObservableCollection<UrgentRow> Posts { get; } = [];

    public ObservableCollection<CarePlaceRow> CarePlaces { get; } = [];

    public bool IsLoading => State == UrgentListState.Loading;

    public bool NeedsLocation => State == UrgentListState.NeedsLocation;

    public bool IsReady => State == UrgentListState.Ready;

    public bool IsEmpty => State == UrgentListState.Ready && Posts.Count == 0;

    public bool HasCarePlaces => CarePlaceCount > 0;

    public async Task LoadAsync()
    {
        if (await location.GetAccessAsync() != LocationAccess.Granted)
        {
            ShowNeedsLocation(LocationAccess.Denied);
            return;
        }

        await SearchAsync();
    }

    [RelayCommand]
    private async Task UseLocationAsync()
    {
        var access = await location.RequestAccessAsync(LocationRationale.Urgent);
        if (access != LocationAccess.Granted)
        {
            ShowNeedsLocation(access);
            return;
        }

        await SearchAsync();
    }

    [RelayCommand]
    private Task RefreshAsync() => LoadAsync();

    private void ShowNeedsLocation(LocationAccess access)
    {
        LocationNote = access switch
        {
            LocationAccess.Blocked => "Konum izni kapalı. Yakındaki çağrıları görmek için telefonun ayarlarından aç.",
            LocationAccess.Unavailable => "Telefonunda konum kapalı. Açınca yakındaki çağrıları gösteririz.",
            _ => "Yakındaki çağrıları göstermek için konumunu bir kez kullanırız. Konumun kaydedilmez.",
        };
        State = UrgentListState.NeedsLocation;
    }

    private async Task SearchAsync()
    {
        State = UrgentListState.Loading;
        var ok = await RunAsync(async () =>
        {
            var fix = await location.GetCurrentAsync() ?? throw new ApiException(ApiErrorKind.Client,
                "Konumun şu an alınamadı. Açık bir alanda yeniden dene.");
            var posts = await api.NearAsync(fix.Latitude, fix.Longitude);
            var places = await api.CarePlacesAsync(fix.Latitude, fix.Longitude);
            var now = clock.GetUtcNow();

            Posts.Clear();
            foreach (var post in posts.Where(p => p.State == "Open"))
            {
                Posts.Add(UrgentRow.From(post, fix.Latitude, fix.Longitude, now));
            }

            CarePlaces.Clear();
            foreach (var place in places)
            {
                CarePlaces.Add(CarePlaceRow.From(place, fix.Latitude, fix.Longitude));
            }

            CarePlaceCount = CarePlaces.Count;
        });
        State = ok ? UrgentListState.Ready : UrgentListState.Failed;
    }

    [RelayCommand]
    private Task OpenAsync(UrgentRow row) => navigation.GoToAsync(UrgentRoutes.Detail,
        new Dictionary<string, object> { [Routes.Keys.Id] = row.Id });

    [RelayCommand]
    private Task CreateAsync() => navigation.GoToAsync(Routes.UrgentNew);

    [RelayCommand]
    private Task OpenSettingsAsync() => navigation.GoToAsync(Routes.UrgentSettings);

    [RelayCommand]
    private Task CallAsync(CarePlaceRow row) => row.Place.Phone is { Length: > 0 } phone
        ? launcher.OpenAsync("tel:" + new string([.. phone.Where(c => char.IsAsciiDigit(c) || c == '+')]))
        : Task.CompletedTask;
}

/// <summary>One urgent post: photo, note, how far and how long ago, and for its author the state buttons.</summary>
public sealed partial class UrgentDetailViewModel(
    UrgentApi api, INavigationService navigation, IAppLauncher launcher, TimeProvider clock) : ViewModelBase
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPost))]
    public partial UrgentRow? Post { get; set; }

    [ObservableProperty]
    public partial string StateText { get; set; } = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanChangeState))]
    public partial bool IsMine { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanChangeState))]
    public partial bool IsOpen { get; set; }

    [ObservableProperty]
    public partial bool IsHandled { get; set; }

    public Guid Id { get; set; }

    public bool HasPost => Post is not null;

    [ObservableProperty] public partial bool OwnSupporter { get; set; }
    public bool CanChangeState => IsMine && (IsOpen || IsHandled);

    public ObservableCollection<CarePlaceRow> CarePlaces { get; } = [];

    public void ApplyQuery(IDictionary<string, object> query)
    {
        if (query.TryGetValue(Routes.Keys.Id, out var value))
        {
            Id = value switch
            {
                Guid id => id,
                string text when Guid.TryParse(text, out var parsed) => parsed,
                _ => Guid.Empty,
            };
        }
    }

    public async Task LoadAsync()
    {
        if (Id == Guid.Empty)
        {
            ErrorMessage = ErrorMessages.For(ErrorCodes.UrgentNotFound, 404);
            return;
        }

        await RunAsync(async () =>
        {
            var post = await api.GetAsync(Id);
            Show(post);
            if (api.Client.Tokens.UserId is not null)
            {
                IsMine = (await api.MineAsync()).Any(p => p.Id == post.Id);
                OwnSupporter = IsMine && (await api.Client.SendAsync<Patika.Contracts.Subscriptions.EntitlementResponse>(HttpMethod.Get, "me/entitlement", null, AuthMode.Required))?.Supporter == true;
            }

            var places = await api.CarePlacesAsync(post.Location.Latitude, post.Location.Longitude);
            CarePlaces.Clear();
            foreach (var place in places)
            {
                CarePlaces.Add(CarePlaceRow.From(place, post.Location.Latitude, post.Location.Longitude));
            }
        });
    }

    private void Show(UrgentPostResponse post)
    {
        Post = UrgentRow.From(post, null, null, clock.GetUtcNow());
        StateText = UrgentText.State(post.State);
        IsOpen = post.State == "Open";
        IsHandled = post.State == "Handled";
    }

    [RelayCommand]
    private Task MarkHandledAsync() => MoveAsync("Handled");

    [RelayCommand]
    private Task CloseAsync() => MoveAsync("Closed");

    private Task MoveAsync(string state) => RunAsync(async () => Show(await api.SetStateAsync(Id, state)));

    [RelayCommand]
    private Task DirectionsAsync() => Post is { } row
        ? launcher.OpenAsync(string.Create(System.Globalization.CultureInfo.InvariantCulture,
            $"geo:{row.Post.Location.Latitude:0.######},{row.Post.Location.Longitude:0.######}?q={row.Post.Location.Latitude:0.######},{row.Post.Location.Longitude:0.######}"))
        : Task.CompletedTask;

    [RelayCommand]
    private Task CallAsync(CarePlaceRow row) => row.Place.Phone is { Length: > 0 } phone
        ? launcher.OpenAsync("tel:" + new string([.. phone.Where(c => char.IsAsciiDigit(c) || c == '+')]))
        : Task.CompletedTask;

    [RelayCommand]
    private Task BackAsync() => navigation.GoBackAsync();
}

/// <summary>
/// Canvas "AcilYeni": photo, one of four categories, a short note and the current position, then send. At most
/// three posts a day; the API's refusal is shown as such and the send button stays off for the day.
/// </summary>
public sealed partial class UrgentCreateViewModel(
    UrgentApi api, ILocationService location, IUrgentPhotoFlow photos, INavigationService navigation) : ViewModelBase
{
    public const int MinNote = 10;
    public const int MaxNote = 1000;

    private string draftKey = Guid.NewGuid().ToString();
    private GeoFix? fix;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPhoto), nameof(PhotoTitle), nameof(PhotoButton))]
    public partial UrgentPhoto? Photo { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsInjured), nameof(IsSick), nameof(IsTrapped), nameof(IsOther))]
    public partial string? Category { get; set; }

    [ObservableProperty]
    public partial string Note { get; set; } = "";

    [ObservableProperty]
    public partial string LocationText { get; set; } = "Konum alınıyor…";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSend))]
    public partial bool HasLocation { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSend))]
    public partial bool CapReached { get; set; }

    public bool HasPhoto => Photo is not null;

    public string PhotoTitle => HasPhoto ? "Fotoğraf eklendi" : "Bir fotoğraf ekle";

    public string PhotoButton => HasPhoto ? "Yeniden çek" : "Fotoğraf çek";

    public bool IsInjured => Category == "Injured";

    public bool IsSick => Category == "Sick";

    public bool IsTrapped => Category == "Trapped";

    public bool IsOther => Category == "Other";

    public bool CanSend => !CapReached && HasLocation;

    public bool IsSignedIn => api.Client.Tokens.UserId is not null;

    public async Task StartAsync()
    {
        if (!IsSignedIn)
        {
            ErrorMessage = "Acil çağrı açmak için giriş yap.";
            return;
        }

        if (!HasLocation)
        {
            await LocateAsync();
        }
    }

    [RelayCommand]
    private async Task LocateAsync()
    {
        var access = await location.RequestAccessAsync(LocationRationale.Urgent);
        if (access != LocationAccess.Granted)
        {
            fix = null;
            HasLocation = false;
            LocationText = access == LocationAccess.Blocked
                ? "Konum izni kapalı. Çağrı için telefonun ayarlarından aç."
                : "Çağrının yerini bilmeden gönüllülere ulaşamayız.";
            return;
        }

        LocationText = "Konum alınıyor…";
        fix = await location.GetCurrentAsync();
        HasLocation = fix is not null;
        LocationText = fix is null
            ? "Konumun alınamadı. Açık bir alanda yeniden dene."
            : fix.AccuracyMeters is > 100
                ? "Şu anki konumun kullanılacak (yaklaşık)"
                : "Şu anki konumun kullanılacak";
    }

    [RelayCommand]
    private void SelectCategory(string category)
    {
        if (UrgentText.Categories.Contains(category))
        {
            Category = category;
        }
    }

    [RelayCommand]
    private async Task TakePhotoAsync()
    {
        UrgentPhoto? taken = null;
        if (await RunAsync(async () => taken = await photos.CaptureAsync()) && taken is not null)
        {
            Photo = taken;
        }
    }

    [RelayCommand]
    private async Task SendAsync()
    {
        if (!IsSignedIn)
        {
            await navigation.GoToAsync(Routes.SignIn);
            return;
        }

        if (CapReached)
        {
            ErrorMessage = UrgentText.DailyCap;
            return;
        }

        var note = Note.Trim();
        var problem = Photo is null ? "Bir fotoğraf ekle; gönüllüler hayvanı tanısın."
            : Category is null ? "Ne olduğunu seç."
            : note.Length < MinNote ? $"Kısa bir not yaz (en az {MinNote} karakter)."
            : note.Length > MaxNote ? $"Not en fazla {MaxNote} karakter olabilir."
            : fix is null ? "Önce konumunu al."
            : null;
        if (problem is not null)
        {
            ErrorMessage = problem;
            return;
        }

        UrgentPostResponse? created = null;
        var request = new CreateUrgentPostRequest(new CoordinateDto(fix!.Latitude, fix.Longitude), Category!, note, Photo!.Key);
        try
        {
            IsBusy = true;
            ErrorMessage = null;
            created = await api.CreateAsync(request, draftKey);
        }
        catch (ApiException e) when (e.Code == ErrorCodes.UrgentDailyCap)
        {
            CapReached = true;
            ErrorMessage = UrgentText.DailyCap;
        }
        catch (ApiException e)
        {
            // A network failure keeps the draft key: sending again cannot open a second post.
            ErrorMessage = e.Message;
        }
        finally
        {
            IsBusy = false;
        }

        if (created is null)
        {
            return;
        }

        draftKey = Guid.NewGuid().ToString();
        fix = null;
        await navigation.GoToAsync("../" + UrgentRoutes.Detail, new Dictionary<string, object> { [Routes.Keys.Id] = created.Id });
    }

    [RelayCommand]
    private Task CancelAsync() => navigation.GoBackAsync();
}

/// <summary>
/// Canvas "AcilAyar": opt-in, the home area (from the current position or moved on the drawn map, rounded to
/// about 100 m before it is sent) and the radius 500..2000 m. Never live tracking: the area is saved once.
/// </summary>
public sealed partial class UrgentSettingsViewModel(
    UrgentApi api, ILocationService location, PushRegistration push, INavigationService navigation) : ViewModelBase
{
    [ObservableProperty]
    public partial bool OptIn { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasArea), nameof(AreaText))]
    public partial CoordinateDto? Area { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(RadiusText))]
    public partial double Radius { get; set; } = HomeArea.DefaultRadiusMeters;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasNotice))]
    public partial string? Notice { get; set; }

    public bool HasNotice => Notice is { Length: > 0 };

    public bool HasArea => Area is not null;

    public int RadiusMeters => HomeArea.SnapRadius(Radius);

    public string RadiusText => UrgentText.Radius(RadiusMeters);

    public string AreaText => Area is { } area
        ? string.Create(UrgentText.Turkish, $"Seçili bölge: {area.Latitude:0.000}, {area.Longitude:0.000} çevresi.")
        : "Henüz bir ev bölgesi seçmedin.";

    public bool PushConfigured => push.IsConfigured;

    public async Task LoadAsync()
    {
        if (api.Client.Tokens.UserId is null)
        {
            await navigation.GoToAsync(Routes.SignIn);
            return;
        }

        await RunAsync(async () =>
        {
            var settings = await api.GetSettingsAsync();
            OptIn = settings.OptIn;
            Area = settings.HomeArea;
            Radius = HomeArea.SnapRadius(settings.RadiusMeters);
        });
    }

    /// <summary>A position picked on the map comes back through the query.</summary>
    public void ApplyQuery(IDictionary<string, object> query)
    {
        if (query.TryGetValue(UrgentRoutes.LatitudeKey, out var lat) && lat is double latitude
            && query.TryGetValue(UrgentRoutes.LongitudeKey, out var lng) && lng is double longitude)
        {
            SetArea(latitude, longitude);
        }
    }

    partial void OnRadiusChanged(double value)
    {
        var snapped = HomeArea.SnapRadius(value);
        if (Math.Abs(snapped - value) > 0.001)
        {
            Radius = snapped;
        }
    }

    /// <summary>Rounds at once: the unrounded position is not kept, not even in memory.</summary>
    public void SetArea(double latitude, double longitude) => Area = HomeArea.Round(latitude, longitude);

    [RelayCommand]
    private async Task UseCurrentPositionAsync()
    {
        var access = await location.RequestAccessAsync(
            "Ev bölgeni bir kez, yaklaşık 100 m’ye yuvarlayarak kaydederiz. Anlık konumun takip edilmez.");
        if (access != LocationAccess.Granted)
        {
            ErrorMessage = access == LocationAccess.Blocked
                ? "Konum izni kapalı. Bölgeyi haritada seçebilirsin."
                : "Konum izni olmadan bölgeyi haritada seçebilirsin.";
            return;
        }

        if (await location.GetCurrentAsync() is { } fix)
        {
            SetArea(fix.Latitude, fix.Longitude);
            ErrorMessage = null;
        }
        else
        {
            ErrorMessage = "Konumun alınamadı. Bölgeyi haritada seçebilirsin.";
        }
    }

    [RelayCommand]
    private Task PickOnMapAsync()
    {
        var parameters = new Dictionary<string, object>();
        if (Area is { } area)
        {
            parameters[UrgentRoutes.LatitudeKey] = area.Latitude;
            parameters[UrgentRoutes.LongitudeKey] = area.Longitude;
        }

        return navigation.GoToAsync(UrgentRoutes.AreaPick, parameters);
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (OptIn && Area is null)
        {
            ErrorMessage = "Bildirim almak için önce ev bölgeni seç.";
            return;
        }

        Notice = null;
        var request = new UrgentSettingsRequest(OptIn, OptIn ? Area : null, RadiusMeters);
        if (!await RunAsync(async () =>
            {
                var saved = await api.PutSettingsAsync(request);
                OptIn = saved.OptIn;
                Area = saved.HomeArea;
                Radius = HomeArea.SnapRadius(saved.RadiusMeters);
            }))
        {
            return;
        }

        if (!OptIn)
        {
            Notice = "Kaydedildi. Ev bölgen silindi; acil bildirim almayacaksın.";
            return;
        }

        var status = push.IsConfigured ? await push.SetEnabledAsync(true) : PushStatus.NotConfigured;
        Notice = status switch
        {
            PushStatus.Registered => "Kaydedildi. Yakınında biri yardım isteyince haber vereceğiz.",
            PushStatus.NotConfigured => "Kaydedildi. " + PushMessages.NotConfigured,
            _ => "Kaydedildi. " + (push.LastError ?? PushMessages.NoToken),
        };
    }

    [RelayCommand]
    private Task BackAsync() => navigation.GoBackAsync();
}

/// <summary>
/// Moving the home area on the drawn map: the pin stays in the middle and the area moves under it, in metres.
/// The result is rounded like every saved area before it goes back to the settings screen.
/// </summary>
public sealed partial class UrgentAreaPickViewModel(ILocationService location, INavigationService navigation) : ViewModelBase
{
    /// <summary>Istanbul, Kadıköy: where the map starts when there is neither a saved area nor a position.</summary>
    public static readonly CoordinateDto Fallback = new(40.990, 29.027);

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CenterText))]
    public partial CoordinateDto Center { get; set; } = Fallback;

    public string CenterText => string.Create(UrgentText.Turkish, $"{Center.Latitude:0.000}, {Center.Longitude:0.000}");

    public async Task ApplyQueryAsync(IDictionary<string, object> query)
    {
        if (query.TryGetValue(UrgentRoutes.LatitudeKey, out var lat) && lat is double latitude
            && query.TryGetValue(UrgentRoutes.LongitudeKey, out var lng) && lng is double longitude)
        {
            dragged = null;
            Center = HomeArea.Round(latitude, longitude);
            return;
        }

        if (await location.GetAccessAsync() == LocationAccess.Granted && await location.GetCurrentAsync() is { } fix)
        {
            Center = HomeArea.Round(fix.Latitude, fix.Longitude);
        }
    }

    private (double Latitude, double Longitude)? dragged;

    /// <summary>
    /// The map was dragged by this many metres (east and north are positive). Small drags add up on the
    /// unrounded point the user is moving; only the rounded value is shown and returned.
    /// </summary>
    public void Move(double eastMeters, double northMeters)
    {
        var (startLatitude, startLongitude) = dragged ?? (Center.Latitude, Center.Longitude);
        var moved = HomeArea.Offset(startLatitude, startLongitude, eastMeters, northMeters);
        dragged = moved;
        Center = HomeArea.Round(moved.Latitude, moved.Longitude);
    }

    [RelayCommand]
    private Task ConfirmAsync() => navigation.GoToAsync("..", new Dictionary<string, object>
    {
        [UrgentRoutes.LatitudeKey] = Center.Latitude,
        [UrgentRoutes.LongitudeKey] = Center.Longitude,
    });

    [RelayCommand]
    private Task CancelAsync() => navigation.GoBackAsync();
}
