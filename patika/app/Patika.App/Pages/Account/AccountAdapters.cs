using System.Globalization;
using Patika.App.Services;
using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

/// <summary>The sign-in notice lives on the session coordinator, which also sets it when a session expires.</summary>
public sealed class CoordinatorSessionNotice(SessionCoordinator coordinator) : ISessionNotice
{
    public string? Take()
    {
        var notice = coordinator.LastNotice;
        coordinator.LastNotice = null;
        return notice;
    }

    public void Set(string message) => coordinator.LastNotice = message;
}

public sealed class ShellUserNotice : IUserNotice
{
    public Task ShowAsync(string title, string message) =>
        MainThread.InvokeOnMainThreadAsync(() => Shell.Current.DisplayAlertAsync(title, message, "Tamam"));

    public Task<bool> ConfirmAsync(string title, string message, string accept, string cancel) =>
        MainThread.InvokeOnMainThreadAsync(() => Shell.Current.DisplayAlertAsync(title, message, accept, cancel));
}

public sealed class MauiAppLauncher : IAppLauncher
{
    public async Task<bool> OpenAsync(string uri)
    {
        try
        {
            return await Launcher.Default.OpenAsync(new Uri(uri));
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // No app for this link (no dialer on a tablet, no maps app): nothing to open.
            return false;
        }
    }
}

/// <summary>Kept in Preferences: an account id and a date, nothing that needs the keystore.</summary>
public sealed class PreferencesDeletionNoticeStore : IDeletionNoticeStore
{
    private const string UserKey = "patika.deletion.user";
    private const string AfterKey = "patika.deletion.after";

    public Task<PendingDeletion?> ReadAsync()
    {
        var user = Preferences.Default.Get(UserKey, "");
        var after = Preferences.Default.Get(AfterKey, 0L);
        return Task.FromResult(user.Length > 0 && after > 0
            ? new PendingDeletion(user, new DateTimeOffset(after, TimeSpan.Zero))
            : null);
    }

    public Task WriteAsync(PendingDeletion? value)
    {
        if (value is null)
        {
            Preferences.Default.Remove(UserKey);
            Preferences.Default.Remove(AfterKey);
        }
        else
        {
            Preferences.Default.Set(UserKey, value.UserId);
            Preferences.Default.Set(AfterKey, value.ExecuteAfter.UtcTicks);
        }

        return Task.CompletedTask;
    }
}

/// <summary>Version from the package and the licence texts bundled as assets (Resources/Fonts/licenses).</summary>
public sealed class MauiAppAbout : IAppAbout
{
    private static readonly (string Name, string File)[] Bundled =
    [
        ("Nunito (SIL Open Font License 1.1)", "licenses/Nunito-OFL.txt"),
        ("Nunito Sans (SIL Open Font License 1.1)", "licenses/NunitoSans-OFL.txt"),
    ];

    private static readonly (string Name, string Text)[] Notices =
    [
        ("Firebase Cloud Messaging", "Google LLC. Apache License 2.0. Yalnızca bildirim belirteci için kullanılır."),
        ("CommunityToolkit.Mvvm", ".NET Foundation. MIT License."),
        ("Microsoft.Data.Sqlite ve .NET MAUI", "Microsoft. MIT License."),
        ("SQLitePCLRaw", "SourceGear. Apache License 2.0."),
    ];

    public string Version => string.Create(CultureInfo.InvariantCulture, $"{AppInfo.Current.VersionString} ({AppInfo.Current.BuildString})");

    public async Task<IReadOnlyList<(string Name, string Text)>> ReadLicencesAsync()
    {
        var items = new List<(string, string)>();
        foreach (var (name, file) in Bundled)
        {
            try
            {
                await using var stream = await FileSystem.Current.OpenAppPackageFileAsync(file);
                using var reader = new StreamReader(stream);
                items.Add((name, await reader.ReadToEndAsync()));
            }
            catch (FileNotFoundException)
            {
                items.Add((name, "Lisans metni bu pakette bulunamadı."));
            }
        }

        items.AddRange(Notices);
        return items;
    }
}
