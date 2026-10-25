using Patika.App.ViewModels.Stations;

namespace Patika.App.Pages.Stations;

/// <summary>Canvas "IstasyonEkle".</summary>
public partial class NewStationPage : ContentPage
{
    private const string Camera = "Fotoğraf çek";
    private const string Gallery = "Galeriden seç";

    private readonly NewStationViewModel viewModel;

    public NewStationPage(NewStationViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
    }

    private async void OnPhotoTapped(object? sender, TappedEventArgs e)
    {
        var choice = viewModel.CanCapture
            ? await DisplayActionSheetAsync("İstasyonun fotoğrafı", "Vazgeç", null, Camera, Gallery)
            : Gallery;
        if (choice == Camera)
        {
            await viewModel.CaptureAsync();
        }
        else if (choice == Gallery)
        {
            await viewModel.PickAsync();
        }
    }
}
