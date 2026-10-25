using System.Globalization;
using Patika.App.Core.Api;
using Patika.App.Core.Push;
using Patika.App.ViewModels.Urgent;

namespace Patika.App.ViewModels.Account;

/// <summary>Turkish text shared by the account screens.</summary>
public static class AccountText
{
    public static readonly CultureInfo Turkish = CultureInfo.GetCultureInfo("tr-TR");

    public const string DeletionCancelledTitle = "Hesabın açık";
    public const string DeletionCancelled = "Hesabını silme isteğin iptal edildi. Her şey olduğu gibi duruyor.";
    public const string PasswordChanged = "Şifren değişti. Yeni şifrenle giriş yap.";
    public const string CodeInvalid = "Kod hatalı ya da süresi dolmuş. Yeni kod iste.";
    public const string CodeFormat = "E-postadaki 6 haneli kodu yaz.";
    public const string CodeSent = "Yeni kod gönderildi. E-postanı kontrol et.";
    public const string WrongPassword = "Şifren hatalı. Yeniden dene.";
    public const string PasswordRule = "Şifre en az 10 karakter olmalı.";

    public static string Date(DateTimeOffset at) => at.ToLocalTime().ToString("d MMMM", Turkish);

    public static string AccountClosed(DateTimeOffset executeAfter) =>
        $"Hesabın kapandı. {Date(executeAfter)} tarihine kadar yeniden giriş yaparsan silme iptal olur.";
}

/// <summary>
/// What every sign-in path and sign-out share: the deletion-cancelled notice after a sign-in, and removing
/// this device's push token before the session ends.
/// </summary>
public sealed class AccountSession(PatikaApiClient api, PushRegistration push, IDeletionNoticeStore deletions, TimeProvider clock)
{
    public PatikaApiClient Api => api;

    public bool IsSignedIn => api.Tokens.UserId is not null;

    /// <summary>
    /// Call after a successful sign-in. Returns the notice to show when this account had asked for deletion
    /// on this device and the grace period has not ended (signing in cancels it on the server).
    /// </summary>
    public async Task<string?> AfterSignInAsync()
    {
        var pending = await deletions.ReadAsync();
        if (pending is null)
        {
            return null;
        }

        if (pending.ExecuteAfter <= clock.GetUtcNow())
        {
            await deletions.WriteAsync(null);
            return null;
        }

        if (!string.Equals(pending.UserId, api.Tokens.UserId, StringComparison.Ordinal))
        {
            return null;
        }

        await deletions.WriteAsync(null);
        return AccountText.DeletionCancelled;
    }

    /// <summary>Removes the push token while the session still works, then signs out (local wipe always happens).</summary>
    public async Task SignOutAsync()
    {
        await push.UnregisterAsync();
        await api.SignOutAsync();
    }
}

/// <summary>
/// The wipe after an accepted account deletion, wider than sign-out: the normal sign-out wipe (tokens, outbox
/// and map cache through the token manager's sign-out hooks), then the FCM token, the push state, the
/// installation id and the urgent photo previews. The deletion notice marker stays so a sign-in within the
/// grace period can say the deletion was cancelled.
/// </summary>
public sealed class AccountDeletionWipe(PatikaApiClient api, PushRegistration push, UrgentPreviewFiles previews)
{
    public async Task WipeAsync()
    {
        await api.SignOutAsync();
        await push.ForgetDeviceAsync();
        previews.DeleteAll();
    }
}

/// <summary>
/// "Send the code again" timing for the verification and reset screens: a code was just sent when the screen
/// opens, so the button waits a minute; after a refusal for too many requests it waits longer.
/// </summary>
public sealed class ResendCooldown(TimeProvider clock)
{
    public static readonly TimeSpan AfterSend = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan AfterRateLimit = TimeSpan.FromMinutes(5);

    private DateTimeOffset availableAt = DateTimeOffset.MinValue;

    public void Start(TimeSpan wait) => availableAt = clock.GetUtcNow() + wait;

    public TimeSpan Remaining
    {
        get
        {
            var left = availableAt - clock.GetUtcNow();
            return left > TimeSpan.Zero ? left : TimeSpan.Zero;
        }
    }

    public bool IsReady => Remaining == TimeSpan.Zero;

    /// <summary>"Kodu yeniden gönder" or "Kodu yeniden gönder, 0:42" while waiting.</summary>
    public string Label
    {
        get
        {
            var left = Remaining;
            if (left == TimeSpan.Zero)
            {
                return "Kodu yeniden gönder";
            }

            var seconds = (int)Math.Ceiling(left.TotalSeconds);
            return string.Create(CultureInfo.InvariantCulture, $"Kodu yeniden gönder, {seconds / 60}:{seconds % 60:00}");
        }
    }
}
