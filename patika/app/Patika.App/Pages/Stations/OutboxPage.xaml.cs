using Patika.App.Core.Offline;
using Patika.App.ViewModels.Stations;

namespace Patika.App.Pages.Stations;

/// <summary>Canvas "Cevrimdisi": stays current while open, since the queue drains in the background.</summary>
public partial class OutboxPage : ContentPage
{
    private readonly OutboxViewModel viewModel;
    private readonly Outbox outbox;
    private readonly INetworkStatus network;

    public OutboxPage(OutboxViewModel viewModel, Outbox outbox, INetworkStatus network)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
        this.outbox = outbox;
        this.network = network;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        outbox.Changed += OnChanged;
        network.Changed += OnNetwork;
        await viewModel.LoadAsync();
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        outbox.Changed -= OnChanged;
        network.Changed -= OnNetwork;
    }

    private void OnChanged(object? sender, EventArgs e) => MainThread.BeginInvokeOnMainThread(() => _ = viewModel.LoadAsync());

    private void OnNetwork(object? sender, bool online) => OnChanged(sender, EventArgs.Empty);
}
