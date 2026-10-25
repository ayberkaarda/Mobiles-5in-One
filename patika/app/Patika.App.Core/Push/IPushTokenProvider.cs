namespace Patika.App.Core.Push;

/// <summary>
/// The platform push service (FCM on Android). The app registers the FCM adapter when the build carries a
/// Firebase configuration and <see cref="NoPushTokenProvider"/> otherwise, so the rest of the app never
/// needs to know whether push is set up.
/// </summary>
public interface IPushTokenProvider
{
    /// <summary>False when this build has no push configuration (no <c>google-services.json</c>).</summary>
    bool IsAvailable { get; }

    /// <summary>The current registration token, or null when there is none (not configured, no Play services).</summary>
    Task<string?> GetTokenAsync(CancellationToken ct = default);

    /// <summary>Deletes the current token at the push service (account deletion); a later call makes a new one.</summary>
    Task DeleteTokenAsync(CancellationToken ct = default);

    /// <summary>Raised when the push service rotates the token; the new token is the argument.</summary>
    event EventHandler<string>? TokenChanged;
}

/// <summary>Push is not configured in this build: no token, nothing registered, nothing shown.</summary>
public sealed class NoPushTokenProvider : IPushTokenProvider
{
    public bool IsAvailable => false;

    public event EventHandler<string>? TokenChanged
    {
        add { }
        remove { }
    }

    public Task<string?> GetTokenAsync(CancellationToken ct = default) => Task.FromResult<string?>(null);

    public Task DeleteTokenAsync(CancellationToken ct = default) => Task.CompletedTask;
}

/// <summary>The runtime notification permission (Android 13 and later ask for it; older versions always allow).</summary>
public interface INotificationPermission
{
    Task<bool> IsGrantedAsync();

    /// <summary>Asks the system when needed; true when notifications may be shown.</summary>
    Task<bool> RequestAsync();
}
