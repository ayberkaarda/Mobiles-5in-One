using Patika.App.ViewModels.Stations;

namespace Patika.App.Pages.Stations;

public partial class StationPage : ContentPage
{
    private readonly StationViewModel viewModel;
    private bool shown;

    public StationPage(StationViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        // The first load starts from the route's id; later appearances (back from Beslendi) refresh.
        if (shown)
        {
            await viewModel.LoadAsync();
        }

        shown = true;
    }
}
