using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

public partial class SignUpPage : ContentPage
{
    public SignUpPage(SignUpViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
