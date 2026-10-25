using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

public partial class VerifyPage : ContentPage
{
    public VerifyPage(VerifyViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
