using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

public partial class ForgotPasswordPage : ContentPage, IQueryAttributable
{
    private readonly ForgotPasswordViewModel viewModel;

    public ForgotPasswordPage(ForgotPasswordViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
    }

    public void ApplyQueryAttributes(IDictionary<string, object> query) => viewModel.ApplyQuery(query);
}
