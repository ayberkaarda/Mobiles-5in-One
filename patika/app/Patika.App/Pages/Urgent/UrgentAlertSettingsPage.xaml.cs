using System.ComponentModel;
using Patika.App.ViewModels.Urgent;

namespace Patika.App.Pages.Urgent;

public partial class UrgentAlertSettingsPage : ContentPage, IQueryAttributable
{
    private readonly UrgentSettingsViewModel viewModel;
    private readonly AreaDrawable drawable = new();
    private bool loaded;

    public UrgentAlertSettingsPage(UrgentSettingsViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
        AreaMap.Drawable = drawable;
        viewModel.PropertyChanged += OnModelChanged;
        Redraw();
    }

    public void ApplyQueryAttributes(IDictionary<string, object> query) => viewModel.ApplyQuery(query);

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        // Coming back from the map pick must not overwrite the picked area with the saved one.
        if (!loaded)
        {
            loaded = true;
            await viewModel.LoadAsync();
        }
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(UrgentSettingsViewModel.Radius) or nameof(UrgentSettingsViewModel.Area))
        {
            Redraw();
        }
    }

    private void Redraw()
    {
        drawable.RadiusMeters = viewModel.RadiusMeters;
        drawable.HasArea = viewModel.HasArea;
        AreaMap.Invalidate();
    }
}
