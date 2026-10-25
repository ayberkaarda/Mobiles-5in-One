using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

public partial class SignInPage : ContentPage
{
    private readonly SignInViewModel viewModel;

    public SignInPage(SignInViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        viewModel.OnAppearing();
    }
}
