using Patika.App.ViewModels.Stations;

namespace Patika.App.Pages.Stations;

/// <summary>Canvas "Bekleme".</summary>
public partial class FeedingCooldownPage : ContentPage
{
    private readonly FeedingCooldownViewModel viewModel;

    public FeedingCooldownPage(FeedingCooldownViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        viewModel.Start();
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        viewModel.Dispose();
    }
}
