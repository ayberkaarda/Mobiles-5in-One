using Patika.App.ViewModels.Stations;

namespace Patika.App.Pages.Stations;

/// <summary>Canvas "Beslendi".</summary>
public partial class FeedingDonePage : ContentPage
{
    public FeedingDonePage(FeedingDoneViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
