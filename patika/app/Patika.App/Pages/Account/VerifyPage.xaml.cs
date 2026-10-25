using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

public partial class VerifyPage : ContentPage, IQueryAttributable
{
    private readonly VerifyViewModel viewModel;
    private readonly IDispatcherTimer timer;

    public VerifyPage(VerifyViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
        timer = CodeBoxes.SecondTimer(Dispatcher, viewModel);
    }

    public void ApplyQueryAttributes(IDictionary<string, object> query) => viewModel.ApplyQuery(query);

    protected override void OnAppearing()
    {
        base.OnAppearing();
        timer.Start();
    }

    protected override void OnDisappearing()
    {
        timer.Stop();
        base.OnDisappearing();
    }
}
