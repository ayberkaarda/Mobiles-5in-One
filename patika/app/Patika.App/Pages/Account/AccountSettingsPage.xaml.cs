using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

public partial class AccountSettingsPage : ContentPage
{
    private readonly AccountSettingsViewModel viewModel;

    public AccountSettingsPage(AccountSettingsViewModel viewModel)
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
