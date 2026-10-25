using Patika.App.ViewModels.Stations;

namespace Patika.App.Pages.Stations;

public partial class OutboxPage : ContentPage
{
    private readonly OutboxViewModel viewModel;

    public OutboxPage(OutboxViewModel viewModel)
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
