using Patika.App.ViewModels.Urgent;

namespace Patika.App.Pages.Urgent;

public partial class UrgentCreatePage : ContentPage
{
    private readonly UrgentCreateViewModel viewModel;

    public UrgentCreatePage(UrgentCreateViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await viewModel.StartAsync();
    }
}
