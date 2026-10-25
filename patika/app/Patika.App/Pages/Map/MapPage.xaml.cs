using Patika.App.ViewModels.Map;

namespace Patika.App.Pages.Map;

public partial class MapPage : ContentPage
{
    private readonly MapViewModel viewModel;

    public MapPage(MapViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        // Back from Beslendi or a new station: the selected card and the pins may have changed.
        await viewModel.AppearAsync();
    }
}
