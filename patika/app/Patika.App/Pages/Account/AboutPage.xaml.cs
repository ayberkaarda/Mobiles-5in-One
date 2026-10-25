using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

public partial class AboutPage : ContentPage
{
    private readonly AboutViewModel viewModel;

    public AboutPage(AboutViewModel viewModel)
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
