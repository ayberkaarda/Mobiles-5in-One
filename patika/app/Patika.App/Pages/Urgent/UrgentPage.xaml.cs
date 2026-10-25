using Patika.App.ViewModels.Urgent;

namespace Patika.App.Pages.Urgent;

public partial class UrgentPage : ContentPage
{
    private readonly UrgentListViewModel viewModel;

    public UrgentPage(UrgentListViewModel viewModel)
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
