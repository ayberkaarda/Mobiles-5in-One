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
        await viewModel.LoadAsync();
    }
}
