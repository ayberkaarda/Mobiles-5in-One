using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

public partial class SignInPage : ContentPage, IQueryAttributable
{
    private readonly SignInViewModel viewModel;

    public SignInPage(SignInViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
    }

    public void ApplyQueryAttributes(IDictionary<string, object> query) => viewModel.ApplyQuery(query);

    protected override void OnAppearing()
    {
        base.OnAppearing();
        viewModel.OnAppearing();
    }
}
