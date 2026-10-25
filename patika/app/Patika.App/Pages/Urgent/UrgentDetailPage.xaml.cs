using Patika.App.ViewModels.Urgent;

namespace Patika.App.Pages.Urgent;

public partial class UrgentDetailPage : ContentPage, IQueryAttributable
{
    private readonly UrgentDetailViewModel viewModel;

    public UrgentDetailPage(UrgentDetailViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
    }

    public void ApplyQueryAttributes(IDictionary<string, object> query) => viewModel.ApplyQuery(query);

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await viewModel.LoadAsync();
    }
}
