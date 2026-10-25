using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

public partial class AccountDeletionPage : ContentPage
{
    private readonly AccountDeletionViewModel viewModel;

    public AccountDeletionPage(AccountDeletionViewModel viewModel)
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
