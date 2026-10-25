using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Location;
using Patika.App.Core.Map;
using Patika.App.Core.Media;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.App.Core.Offline;
using Patika.App.ViewModels.Map;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;

namespace Patika.App.ViewModels.Stations;

/// <summary>
/// Canvas "IstasyonEkle": drag the map so the fixed pin sits on the station (or use the current
/// position), pick what is left and for whom, add the required photo and an optional name. The photo is
/// re-encoded and stripped of all metadata, GPS included, on the phone before upload; the station's own
/// position is the pin, which the user placed on purpose. Needs a connection; body and Idempotency-Key are
/// frozen together until the outcome is known (<see cref="StationSubmission"/>), so a retry after a lost
/// answer cannot create the station twice or send another body under the same key.
/// </summary>
public sealed partial class NewStationViewModel : ViewModelBase
{
    private readonly PatikaApiClient api;
    private readonly IPhotoUploader uploader;
    private readonly IPhotoPicker picker;
    private readonly ILocationService location;
    private readonly INetworkStatus network;
    private readonly INavigationService navigation;
    private readonly MapViewModel map;
    private readonly StationSubmission submission = new();
    private PreparedPhoto? photo;
    private string? photoKey;

    public NewStationViewModel(PatikaApiClient api, IPhotoUploader uploader, IPhotoPicker picker, ILocationService location,
        INetworkStatus network, INavigationService navigation, MapViewModel map)
    {
        this.api = api;
        this.uploader = uploader;
        this.picker = picker;
        this.location = location;
        this.network = network;
        this.navigation = navigation;
        this.map = map;
        Viewport = map.CurrentViewport with { Zoom = Math.Max(map.CurrentViewport.Zoom, 17) };
    }

    [ObservableProperty]
    public partial MapViewport Viewport { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsFood), nameof(IsWater), nameof(IsBoth))]
    public partial string Kind { get; set; } = "Food";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsCat), nameof(IsDog), nameof(IsMixed))]
    public partial string Species { get; set; } = "Cat";

    [ObservableProperty]
    public partial string? Name { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPhoto), nameof(HasNoPhoto))]
    [NotifyCanExecuteChangedFor(nameof(SubmitCommand))]
    public partial ImageSource? Preview { get; set; }

    [ObservableProperty]
    public partial string PhotoNote { get; set; } = "Kapları ve yeri gösteren bir kare yeter. Konum bilgisi telefonda silinir.";

    public bool CanCapture => picker.CanCapture;

    public bool HasPhoto => Preview is not null;

    public bool HasNoPhoto => Preview is null;

    public bool IsFood => Kind == "Food";

    public bool IsWater => Kind == "Water";

    public bool IsBoth => Kind == "Both";

    public bool IsCat => Species == "Cat";

    public bool IsDog => Species == "Dog";

    public bool IsMixed => Species == "Mixed";

    [RelayCommand]
    private void SetKind(string kind)
    {
        Kind = kind;
    }

    [RelayCommand]
    private void SetSpecies(string species)
    {
        Species = species;
    }

    [RelayCommand]
    private void Moved(MapViewport? viewport)
    {
        if (viewport is not null && viewport != Viewport)
        {
            Viewport = viewport;
        }
    }

    [RelayCommand]
    private async Task UseMyLocationAsync()
    {
        var access = await location.RequestAccessAsync(LocationRationale.Station);
        if (access != LocationAccess.Granted)
        {
            ErrorMessage = access == LocationAccess.Blocked
                ? "Konum izni kapalı. Haritayı kaydırarak iğneyi yerine getirebilirsin."
                : "Konum olmadan da iğneyi haritayı kaydırarak yerleştirebilirsin.";
            return;
        }

        if (await location.GetCurrentAsync() is { } fix)
        {
            Viewport = Viewport.CenterOn(fix.Latitude, fix.Longitude, Math.Max(Viewport.Zoom, 17));
        }
        else
        {
            ErrorMessage = "Konumun şu an alınamadı. Haritayı kaydırarak devam edebilirsin.";
        }
    }

    public Task CaptureAsync() => TakeAsync(picker.CaptureAsync);

    public Task PickAsync() => TakeAsync(picker.PickAsync);

    private async Task TakeAsync(Func<CancellationToken, Task<PickedPhoto?>> source)
    {
        ErrorMessage = null;
        try
        {
            var picked = await source(CancellationToken.None);
            if (picked is null)
            {
                return;
            }

            IsBusy = true;
            var prepared = await uploader.PrepareAsync(picked);
            photo = prepared;
            photoKey = null;
            Preview = ImageSource.FromStream(prepared.OpenRead);
            PhotoNote = string.Create(StationText.Turkish,
                $"Fotoğraf hazır: {prepared.Width}×{prepared.Height}, konum ve cihaz bilgisi silindi.");
        }
        catch (PhotoException e)
        {
            ErrorMessage = e.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    private bool CanSubmit() => Preview is not null;

    [RelayCommand(CanExecute = nameof(CanSubmit))]
    private async Task SubmitAsync()
    {
        if (photo is null)
        {
            ErrorMessage = "Fotoğraf gerekli.";
            return;
        }

        if (!network.IsOnline)
        {
            ErrorMessage = "İstasyon eklemek için bağlantı gerekli. Bağlantı gelince yeniden dene.";
            return;
        }

        StationResponse? created = null;
        await RunAsync(async () =>
        {
            if (submission.Unresolved is { } unresolved)
            {
                // The last send got no answer: finish that one exactly as sent, form changes wait for it.
                created = await submission.SubmitAsync(unresolved, Send);
                return;
            }

            // The photo key survives a failed create, so a retry does not upload (and spend quota) again.
            photoKey ??= await uploader.UploadAsync(photo, "station");
            var name = string.IsNullOrWhiteSpace(Name) ? null : Name.Trim();
            created = await submission.SubmitAsync(new StationRequest(
                new CoordinateDto(Math.Round(Viewport.Latitude, 6), Math.Round(Viewport.Longitude, 6)),
                Kind, Species, photoKey, name), Send);
        });
        if (created is null && submission.Unresolved is not null)
        {
            ErrorMessage += " Son gönderimin sonucu belli değil; yeniden denediğinde aynı bilgilerle tamamlanır.";
        }
        if (created is not null)
        {
            map.ShowCreated(created);
            await navigation.GoToAsync(Routes.Map);
        }
    }

    [RelayCommand]
    private Task CancelAsync() => navigation.GoBackAsync();

    private Task<StationResponse> Send(StationRequest body, string key, CancellationToken ct) =>
        api.CreateStationAsync(body, key, ct);
}
