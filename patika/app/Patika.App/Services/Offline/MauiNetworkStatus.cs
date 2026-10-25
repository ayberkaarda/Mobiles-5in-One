using Patika.App.Core.Offline;

namespace Patika.App.Services.Offline;

/// <summary>MAUI <see cref="Connectivity"/> as <see cref="INetworkStatus"/>; needs ACCESS_NETWORK_STATE.</summary>
public sealed class MauiNetworkStatus : INetworkStatus
{
    private bool online;

    public MauiNetworkStatus()
    {
        online = Read();
        Connectivity.Current.ConnectivityChanged += OnChanged;
    }

    public bool IsOnline => online;

    public event EventHandler<bool>? Changed;

    private void OnChanged(object? sender, ConnectivityChangedEventArgs e)
    {
        var now = Read();
        if (now == online)
        {
            return;
        }

        online = now;
        Changed?.Invoke(this, now);
    }

    private static bool Read() => Connectivity.Current.NetworkAccess is NetworkAccess.Internet or NetworkAccess.ConstrainedInternet;
}
