using System.Globalization;
using Android.Content;
using Patika.App.Core.Api;
using Patika.App.Core.Push;
using Patika.App.ViewModels.Urgent;

namespace Patika.App.Push;

/// <summary>The installation id in SecureStorage (Android Keystore), so it survives restarts but not a reinstall.</summary>
public sealed class SecureInstallationIdStore : IInstallationIdStore
{
    private const string Key = "patika.installation_id";

    public async Task<string?> ReadAsync()
    {
        try
        {
            return await SecureStorage.Default.GetAsync(Key);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return null;
        }
    }

    public Task WriteAsync(string value) => SecureStorage.Default.SetAsync(Key, value);

    public Task ClearAsync()
    {
        SecureStorage.Default.Remove(Key);
        return Task.CompletedTask;
    }
}

/// <summary>The push switch and the last registered token in Preferences (nothing here is a secret).</summary>
public sealed class PreferencesPushStateStore : IPushStateStore
{
    private const string EnabledKey = "patika.push.enabled";
    private const string TokenKey = "patika.push.token";
    private const string UserKey = "patika.push.user";
    private const string SyncedKey = "patika.push.synced";

    public Task<PushState> ReadAsync()
    {
        var prefs = Preferences.Default;
        var synced = prefs.Get(SyncedKey, 0L);
        return Task.FromResult(new PushState(
            prefs.Get(EnabledKey, true),
            Empty(prefs.Get(TokenKey, "")),
            Empty(prefs.Get(UserKey, "")),
            synced > 0 ? new DateTimeOffset(synced, TimeSpan.Zero) : null));
    }

    public Task WriteAsync(PushState state)
    {
        var prefs = Preferences.Default;
        prefs.Set(EnabledKey, state.Enabled);
        prefs.Set(TokenKey, state.Token ?? "");
        prefs.Set(UserKey, state.UserId ?? "");
        prefs.Set(SyncedKey, state.SyncedAt?.UtcTicks ?? 0L);
        return Task.CompletedTask;
    }

    private static string? Empty(string value) => value.Length == 0 ? null : value;
}

public sealed class AndroidNotificationPermission : INotificationPermission
{
    public async Task<bool> IsGrantedAsync() =>
        await MainThread.InvokeOnMainThreadAsync(Permissions.CheckStatusAsync<Permissions.PostNotifications>) == PermissionStatus.Granted;

    public async Task<bool> RequestAsync()
    {
        var status = await MainThread.InvokeOnMainThreadAsync(Permissions.CheckStatusAsync<Permissions.PostNotifications>);
        if (status != PermissionStatus.Granted)
        {
            status = await MainThread.InvokeOnMainThreadAsync(Permissions.RequestAsync<Permissions.PostNotifications>);
        }

        return status == PermissionStatus.Granted;
    }
}

/// <summary>
/// Activity lifecycle hooks: channels on create, the tapped notification from the launch or new intent, and
/// on resume the pending target and the twice-a-day re-registration.
/// </summary>
public static class PushPlatform
{
    private static IServiceProvider? Services => IPlatformApplication.Current?.Services;

    public static void OnCreated(Android.App.Activity activity)
    {
        NotificationChannels.Ensure(activity);
        Offer(activity.Intent);
    }

    public static void OnNewIntent(Intent? intent)
    {
        Offer(intent);
        Deliver();
    }

    public static void OnResumed()
    {
        Deliver();
        if (Services?.GetService<PushRegistration>() is { } push)
        {
            _ = push.SyncIfDueAsync();
        }
    }

    private static void Offer(Intent? intent)
    {
        if (intent?.Extras is not { } extras || Services?.GetService<NotificationInbox>() is not { } inbox)
        {
            return;
        }

        inbox.Offer(NotificationTarget.From(key => extras.GetString(key)));

        // Consumed: a configuration change must not open the same post again.
        intent.RemoveExtra(NotificationTarget.TypeKey);
        intent.RemoveExtra(NotificationTarget.UrgentIdKey);
    }

    /// <summary>Opens the pending target once the Shell is loaded and a session exists.</summary>
    private static void Deliver()
    {
        if (Services?.GetService<NotificationInbox>() is not { HasPending: true } inbox
            || Services.GetService<TokenManager>() is not { } tokens)
        {
            return;
        }

        if (Shell.Current is not { } shell)
        {
            return;
        }

        if (!shell.IsLoaded)
        {
            void Loaded(object? sender, EventArgs e)
            {
                shell.Loaded -= Loaded;

                // After the session coordinator has picked the first screen.
                shell.Dispatcher.DispatchDelayed(TimeSpan.FromMilliseconds(300), Deliver);
            }

            shell.Loaded += Loaded;
            return;
        }

        shell.Dispatcher.Dispatch(async () =>
        {
            if (tokens.UserId is null && !await tokens.RestoreAsync())
            {
                return;
            }

            if (inbox.Take() is { } target)
            {
                await shell.GoToAsync(string.Create(CultureInfo.InvariantCulture, $"//acil/{UrgentRoutes.Detail}"),
                    new Dictionary<string, object> { [Core.Navigation.Routes.Keys.Id] = target.Id });
            }
        });
    }
}
