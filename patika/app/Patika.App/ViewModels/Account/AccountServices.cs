namespace Patika.App.ViewModels.Account;

/// <summary>Routes of the account screens that are not in the shared route table, and their query keys.</summary>
public static class AccountRoutes
{
    public const string ForgotPassword = "sifremi-unuttum";
    public const string ResetPassword = "sifre-yenile";
    public const string About = "hakkinda";

    public const string NoticeKey = "notice";
}

/// <summary>
/// Google sign-in on the device. Until the owner adds the Android OAuth client id the app registers
/// <see cref="NotConfiguredGoogleSignIn"/>, and the buttons explain that instead of failing silently.
/// </summary>
public interface IGoogleSignIn
{
    bool IsConfigured { get; }

    /// <summary>Shows the account chooser and returns a Google ID token, or null when the user backed out.</summary>
    Task<string?> GetIdTokenAsync(CancellationToken ct = default);
}

public sealed class NotConfiguredGoogleSignIn : IGoogleSignIn
{
    public const string Message = "Google ile giriş bu sürümde henüz açık değil. E-posta ve şifrenle devam edebilirsin.";

    public bool IsConfigured => false;

    public Task<string?> GetIdTokenAsync(CancellationToken ct = default) => Task.FromResult<string?>(null);
}

/// <summary>A one-line message for the sign-in screen, set before the app routes there.</summary>
public interface ISessionNotice
{
    string? Take();

    void Set(string message);
}

/// <summary>A short modal message (title and text) the user acknowledges.</summary>
public interface IUserNotice
{
    Task ShowAsync(string title, string message);

    /// <summary>A yes/no question; true when the user chose <paramref name="accept"/>.</summary>
    Task<bool> ConfirmAsync(string title, string message, string accept, string cancel);
}

/// <summary>Opens a link, a phone number or a map position in another app. Only on the user's tap.</summary>
public interface IAppLauncher
{
    Task<bool> OpenAsync(string uri);
}

/// <summary>
/// Remembers on this device that the signed-in account asked for deletion, so that signing in again within
/// the grace period can say the deletion was cancelled (the API cancels it silently).
/// </summary>
public interface IDeletionNoticeStore
{
    Task<PendingDeletion?> ReadAsync();

    Task WriteAsync(PendingDeletion? value);
}

public sealed record PendingDeletion(string UserId, DateTimeOffset ExecuteAfter);

/// <summary>App name and version for Settings and About.</summary>
public interface IAppAbout
{
    string Version { get; }

    /// <summary>Licence texts shipped with the app, by name.</summary>
    Task<IReadOnlyList<(string Name, string Text)>> ReadLicencesAsync();
}
