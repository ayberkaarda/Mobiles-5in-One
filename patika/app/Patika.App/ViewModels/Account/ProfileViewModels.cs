using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.App.Core.Push;
using Patika.App.ViewModels.Urgent;
using Patika.Contracts.Account;
using Patika.Contracts.Auth;

namespace Patika.App.ViewModels.Account;

/// <summary>Badge codes from <c>/me</c> in Turkish. Unknown codes are skipped rather than shown raw.</summary>
public static class BadgeText
{
    private static readonly Dictionary<string, string> Names = new(StringComparer.Ordinal)
    {
        [MeBadges.FirstFeeding] = "İlk besleme",
        [MeBadges.Feedings10] = "10 besleme",
        [MeBadges.Feedings50] = "50 besleme",
        [MeBadges.Feedings100] = "100 besleme",
        [MeBadges.FirstSighting] = "İlk görülme",
        [MeBadges.FirstAdoptionHelped] = "İlk yuva",
    };

    public static IReadOnlyList<string> For(IEnumerable<string> codes) =>
        [.. codes.Select(c => Names.GetValueOrDefault(c)).OfType<string>()];
}

/// <summary>Canvas "Profil": name, since when, feeding count and badges. No ranking anywhere.</summary>
public sealed partial class ProfileViewModel(PatikaApiClient api, INavigationService navigation) : ViewModelBase
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Initial))]
    public partial string DisplayName { get; set; } = "";

    [ObservableProperty]
    public partial string Since { get; set; } = "";

    [ObservableProperty]
    public partial string FeedingCount { get; set; } = "0";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsMember))]
    public partial bool IsGuest { get; set; }

    [ObservableProperty]
    public partial bool HasBadges { get; set; }

    public bool IsMember => !IsGuest;

    public string Initial => DisplayName is { Length: > 0 } name ? name[..1].ToUpper(AccountText.Turkish) : "";

    public ObservableCollection<string> Badges { get; } = [];

    public async Task LoadAsync()
    {
        if (api.Tokens.UserId is null)
        {
            IsGuest = true;
            DisplayName = "Misafir";
            Since = "Giriş yapınca beslemelerin ve rozetlerin burada görünür.";
            Badges.Clear();
            HasBadges = false;
            return;
        }

        IsGuest = false;
        await RunAsync(async () =>
        {
            var me = await api.GetMeAsync();
            DisplayName = me.DisplayName;
            Since = $"Patika gönüllüsü, {me.JoinedAt.ToLocalTime().ToString("MMMM yyyy", AccountText.Turkish)}’dan beri";
            FeedingCount = me.FeedingCount.ToString("N0", AccountText.Turkish);
            Badges.Clear();
            foreach (var badge in BadgeText.For(me.Badges))
            {
                Badges.Add(badge);
            }

            HasBadges = Badges.Count > 0;
        });
    }

    [RelayCommand]
    private Task OpenSettingsAsync() => navigation.GoToAsync(Routes.Settings);

    [RelayCommand]
    private Task SignInAsync() => navigation.GoToAsync(Routes.SignIn);
}

/// <summary>Canvas "Ayarlar": account, notifications, privacy links, sign-out, deletion, licences and version.</summary>
public sealed partial class AccountSettingsViewModel(
    AccountSession session, PushRegistration push, UrgentApi urgent, INavigationService navigation, IAppLauncher launcher,
    IUserNotice dialogs, IAppAbout info) : ViewModelBase
{
    public const string PrivacyUrl = "https://patika.app/gizlilik";
    public const string KvkkUrl = "https://patika.app/kvkk-aydinlatma";

    private bool loading;

    [ObservableProperty]
    public partial string Email { get; set; } = "";

    [ObservableProperty]
    public partial string EmailState { get; set; } = "";

    [ObservableProperty]
    public partial bool NotificationsEnabled { get; set; }

    [ObservableProperty]
    public partial string NotificationsNote { get; set; } = "";

    [ObservableProperty]
    public partial string UrgentSummary { get; set; } = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsMember))]
    public partial bool IsGuest { get; set; }

    public bool IsMember => !IsGuest;

    public bool PushConfigured => push.IsConfigured;

    public string Version => $"Patika {info.Version}";

    public async Task LoadAsync()
    {
        IsGuest = !session.IsSignedIn;
        loading = true;
        try
        {
            NotificationsEnabled = push.IsConfigured && await push.IsEnabledAsync();
        }
        finally
        {
            loading = false;
        }

        NotificationsNote = Note(push.IsConfigured ? null : PushMessages.NotConfigured);
        if (IsGuest)
        {
            return;
        }

        await RunAsync(async () =>
        {
            var me = await session.Api.GetMeAsync();
            Email = me.Email ?? "Google hesabı";
            EmailState = me.EmailVerified ? "Doğrulandı" : "Doğrulanmadı";
            var settings = await urgent.GetSettingsAsync();
            UrgentSummary = settings.OptIn ? $"Açık, {UrgentText.Radius(settings.RadiusMeters)}" : "Kapalı";
        });
    }

    partial void OnNotificationsEnabledChanged(bool value)
    {
        if (!loading)
        {
            _ = ApplyNotificationsAsync(value);
        }
    }

    /// <summary>The switch: on asks for the permission and registers this device; off removes it from the API.</summary>
    public async Task ApplyNotificationsAsync(bool value)
    {
        if (!push.IsConfigured)
        {
            SetSilently(false);
            NotificationsNote = PushMessages.NotConfigured;
            return;
        }

        var status = await push.SetEnabledAsync(value);
        SetSilently(status is not PushStatus.Off && value);
        NotificationsNote = Note(push.LastError);
    }

    private static string Note(string? error) => error ?? "Acil çağrılar ve takip ettiğin hayvanlar için.";

    private void SetSilently(bool value)
    {
        loading = true;
        NotificationsEnabled = value;
        loading = false;
    }

    [RelayCommand]
    private Task OpenUrgentSettingsAsync() => navigation.GoToAsync(Routes.UrgentSettings);

    [RelayCommand]
    private Task OpenOutboxAsync() => navigation.GoToAsync(Routes.Outbox);

    [RelayCommand]
    private Task OpenPrivacyAsync() => launcher.OpenAsync(PrivacyUrl);

    [RelayCommand]
    private Task OpenKvkkAsync() => launcher.OpenAsync(KvkkUrl);

    [RelayCommand]
    private Task OpenAboutAsync() => navigation.GoToAsync(AccountRoutes.About);

    [RelayCommand]
    private Task DeleteAccountAsync() => navigation.GoToAsync(Routes.DeleteAccount);

    [RelayCommand]
    private async Task SignOutAsync()
    {
        if (!await dialogs.ConfirmAsync("Çıkış yap", "Bu cihazdaki oturumun kapanır. Gönderilmeyi bekleyen kayıtlar silinir.",
                "Çıkış yap", "Vazgeç"))
        {
            return;
        }

        await RunAsync(session.SignOutAsync);
    }

    [RelayCommand]
    private Task BackAsync() => navigation.GoBackAsync();
}

public enum DeletionStep
{
    /// <summary>The grace explanation and the re-authentication form.</summary>
    Explain,

    /// <summary>Deletion accepted: the account is closed and this device is signed out.</summary>
    Done,
}

/// <summary>
/// Canvas "HesapSil": explains the 7-day grace, then deletes after a fresh sign-in (the API accepts deletion
/// only within 10 minutes of a password or Google sign-in, and never with a refreshed token).
/// </summary>
public sealed partial class AccountDeletionViewModel(
    AccountSession session, PushRegistration push, AccountDeletionWipe wipe, IGoogleSignIn google, IDeletionNoticeStore deletions,
    ISessionNotice notices, INavigationService navigation, TimeProvider clock) : ViewModelBase
{
    public static readonly TimeSpan GracePeriod = TimeSpan.FromDays(7);

    [ObservableProperty]
    public partial string? Email { get; set; }

    [ObservableProperty]
    public partial string Password { get; set; } = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsExplaining), nameof(IsDone))]
    public partial DeletionStep Step { get; set; } = DeletionStep.Explain;

    [ObservableProperty]
    public partial string FinalDate { get; set; } = "";

    public bool IsExplaining => Step == DeletionStep.Explain;

    public bool IsDone => Step == DeletionStep.Done;

    /// <summary>Accounts made with Google have no password; they confirm with Google only.</summary>
    public bool HasPassword => Email is not null;

    public async Task LoadAsync()
    {
        FinalDate = AccountText.Date(clock.GetUtcNow() + GracePeriod);
        if (!session.IsSignedIn)
        {
            await navigation.GoToAsync(Routes.SignIn);
            return;
        }

        await RunAsync(async () => Email = (await session.Api.GetMeAsync()).Email);
        OnPropertyChanged(nameof(HasPassword));
    }

    [RelayCommand]
    private async Task DeleteWithPasswordAsync()
    {
        if (Email is null || Password.Length == 0)
        {
            ErrorMessage = "Devam etmek için şifreni yaz.";
            return;
        }

        var email = Email;
        var password = Password;
        await DeleteAsync(async () =>
        {
            try
            {
                await session.Api.SignInAsync(email, password);
            }
            catch (ApiException e) when (e.Code == ErrorCodes.InvalidCredentials)
            {
                throw new ApiException(e.Kind, AccountText.WrongPassword, e.Status, e.Code);
            }

            return true;
        });
    }

    [RelayCommand]
    private async Task DeleteWithGoogleAsync()
    {
        if (!google.IsConfigured)
        {
            ErrorMessage = NotConfiguredGoogleSignIn.Message;
            return;
        }

        await DeleteAsync(async () =>
        {
            if (await google.GetIdTokenAsync() is not { } idToken)
            {
                return false;
            }

            await session.Api.SignInWithGoogleAsync(idToken);
            return true;
        });
    }

    /// <param name="reauthenticate">A fresh sign-in; false when the user backed out of it.</param>
    private async Task DeleteAsync(Func<Task<bool>> reauthenticate)
    {
        AccountDeletionResponse? response = null;
        var ok = await RunAsync(async () =>
        {
            if (!await reauthenticate())
            {
                return;
            }

            Password = "";
            await push.UnregisterAsync();
            try
            {
                response = await session.Api.SendAsync<AccountDeletionResponse>(HttpMethod.Delete, "me", null, AuthMode.Required);
            }
            catch (ApiException)
            {
                // The account stays: put this device's notifications back.
                _ = push.ResumeAsync();
                throw;
            }
        });

        if (!ok || response is null)
        {
            return;
        }

        var userId = session.Api.Tokens.UserId;
        if (userId is not null)
        {
            await deletions.WriteAsync(new PendingDeletion(userId, response.ExecuteAfter));
        }

        FinalDate = AccountText.Date(response.ExecuteAfter);
        Step = DeletionStep.Done;
        notices.Set(AccountText.AccountClosed(response.ExecuteAfter));

        // The server already ended every session; nothing tied to the closed account stays on the phone.
        await wipe.WipeAsync();
    }

    [RelayCommand]
    private Task CancelAsync() => navigation.GoBackAsync();
}

/// <summary>About: version and the licences of what ships inside the app.</summary>
public sealed partial class AboutViewModel(IAppAbout info) : ViewModelBase
{
    public string Version => $"Patika {info.Version}";

    public ObservableCollection<LicenceItem> Licences { get; } = [];

    public async Task LoadAsync()
    {
        if (Licences.Count > 0)
        {
            return;
        }

        foreach (var (name, text) in await info.ReadLicencesAsync())
        {
            Licences.Add(new LicenceItem(name, text));
        }
    }
}

public sealed record LicenceItem(string Name, string Text);
