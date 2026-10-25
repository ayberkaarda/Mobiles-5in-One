namespace Patika.App.Core.Offline;

/// <summary>Connectivity as the platform reports it. The app wraps MAUI's <c>Connectivity</c>.</summary>
public interface INetworkStatus
{
    bool IsOnline { get; }

    /// <summary>Raised with the new value whenever internet access appears or goes away.</summary>
    event EventHandler<bool>? Changed;
}
