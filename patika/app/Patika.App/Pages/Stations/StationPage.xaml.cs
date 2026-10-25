using Patika.App.ViewModels.Stations;

namespace Patika.App.Pages.Stations;

public partial class StationPage : ContentPage
{
    public StationPage(StationViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
