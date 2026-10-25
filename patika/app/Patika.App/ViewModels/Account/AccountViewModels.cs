using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.Contracts.Auth;

namespace Patika.App.ViewModels.Account;

/// <summary>Canvas "Giris": email and password, forgot password, Google, sign-up, browse without an account.</summary>
public sealed partial class SignInViewModel(
    AccountSession session, INavigationService navigation, ISessionNotice notices, IUserNotice dialogs, IGoogleSignIn google)
    : ViewModelBase
{
    [ObservableProperty]
    public partial string Email { get; set; } = "";

    [ObservableProperty]
    public partial string Password { get; set; } = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasNotice))]
    public partial string? Notice { get; set; }

    public bool HasNotice => Notice is { Length: > 0 };

    public void ApplyQuery(IDictionary<string, object> query)
    {
        if (query.TryGetValue(Routes.Keys.Email, out var email) && email is string value)
        {
            Email = value;
        }

        if (query.TryGetValue(AccountRoutes.NoticeKey, out var notice) && notice is string text)
        {
            Notice = text;
        }
    }

    public void OnAppearing()
    {
        if (notices.Take() is { } notice)
        {
            Notice = notice;
        }
    }

    [RelayCommand]
    private async Task SignInAsync()
    {
        if (string.IsNullOrWhiteSpace(Email) || Password.Length == 0)
        {
            ErrorMessage = "E-posta ve şifreni yaz.";
            return;
        }

        if (await RunAsync(() => session.Api.SignInAsync(Email.Trim(), Password)))
        {
            Password = "";
            await CompleteAsync();
        }
    }

    [RelayCommand]
    private async Task GoogleAsync()
    {
        if (!google.IsConfigured)
        {
            ErrorMessage = NotConfiguredGoogleSignIn.Message;
            return;
        }

        string? idToken = null;
        if (await RunAsync(async () =>
            {
                idToken = await google.GetIdTokenAsync();
                if (idToken is not null)
                {
                    await session.Api.SignInWithGoogleAsync(idToken);
                }
            }) && idToken is not null)
        {
            await CompleteAsync();
        }
    }

    [RelayCommand]
    private Task ForgotPasswordAsync() => navigation.GoToAsync(AccountRoutes.ForgotPassword,
        new Dictionary<string, object> { [Routes.Keys.Email] = Email.Trim() });

    [RelayCommand]
    private Task SignUpAsync() => navigation.GoToAsync(Routes.SignUp);

    [RelayCommand]
    private Task BrowseAsGuestAsync() => navigation.GoToAsync(Routes.Map);

    private async Task CompleteAsync()
    {
        Notice = null;
        if (await session.AfterSignInAsync() is { } cancelled)
        {
            await dialogs.ShowAsync(AccountText.DeletionCancelledTitle, cancelled);
        }

        await navigation.GoToAsync(Routes.Map);
    }
}

/// <summary>Registration form; the next step is the six-digit code from the email.</summary>
public sealed partial class SignUpViewModel(PatikaApiClient api, INavigationService navigation) : ViewModelBase
{
    [ObservableProperty]
    public partial string DisplayName { get; set; } = "";

    [ObservableProperty]
    public partial string Email { get; set; } = "";

    [ObservableProperty]
    public partial string Password { get; set; } = "";

    [RelayCommand]
    private async Task RegisterAsync()
    {
        if (string.IsNullOrWhiteSpace(DisplayName) || string.IsNullOrWhiteSpace(Email))
        {
            ErrorMessage = "Adını ve e-postanı yaz.";
            return;
        }

        if (Password.Length < 10)
        {
            ErrorMessage = AccountText.PasswordRule;
            return;
        }

        if (await RunAsync(() => api.RegisterAsync(Email.Trim(), Password, DisplayName.Trim())))
        {
            Password = "";
            await navigation.GoToAsync(Routes.Verify, new Dictionary<string, object> { [Routes.Keys.Email] = Email.Trim() });
        }
    }

    [RelayCommand]
    private Task SignInAsync() => navigation.GoToAsync(Routes.SignIn);
}

/// <summary>Six digits typed into one field and shown as six boxes.</summary>
public abstract partial class CodeEntryViewModel : ViewModelBase
{
    public const int CodeLength = 6;

    protected CodeEntryViewModel(TimeProvider clock)
    {
        Cooldown = new ResendCooldown(clock);
    }

    protected ResendCooldown Cooldown { get; }

    [ObservableProperty]
    public partial string Email { get; set; } = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Digits), nameof(IsComplete))]
    public partial string Code { get; set; } = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasNotice))]
    public partial string? Notice { get; set; }

    public bool HasNotice => Notice is { Length: > 0 };

    public IReadOnlyList<string> Digits =>
        [.. Enumerable.Range(0, CodeLength).Select(i => i < Code.Length ? Code[i].ToString() : "")];

    public bool IsComplete => IsCode(Code);

    public bool CanResend => Cooldown.IsReady && !IsBusy;

    public string ResendLabel => Cooldown.Label;

    /// <summary>The field takes this many characters so a pasted "482 917" or "482-917" fits before it is cleaned.</summary>
    public const int MaxInputLength = 24;

    /// <summary>Digits only, then at most six: what the code field keeps of whatever was typed or pasted.</summary>
    public static string Normalize(string? raw) =>
        new([.. (raw ?? "").Where(char.IsAsciiDigit).Take(CodeLength)]);

    /// <summary>The code field's text-changed handler: normalizes first, then stores (which may verify).</summary>
    public void AcceptInput(string? raw)
    {
        var digits = Normalize(raw);
        if (!string.Equals(digits, Code, StringComparison.Ordinal))
        {
            Code = digits;
        }
    }

    public static bool IsCode(string? value) => value is { Length: CodeLength } && value.All(char.IsAsciiDigit);

    public void ApplyQuery(IDictionary<string, object> query)
    {
        if (query.TryGetValue(Routes.Keys.Email, out var email) && email is string value)
        {
            Email = value;
        }

        // The screen opens right after a code was sent.
        Cooldown.Start(ResendCooldown.AfterSend);
        Tick();
    }

    /// <summary>Called every second by the page while it is visible.</summary>
    public void Tick()
    {
        OnPropertyChanged(nameof(CanResend));
        OnPropertyChanged(nameof(ResendLabel));
    }

    partial void OnCodeChanged(string value)
    {
        var digits = Normalize(value);
        if (!string.Equals(digits, value, StringComparison.Ordinal))
        {
            Code = digits;
            return;
        }

        if (IsCode(value))
        {
            OnCodeCompleted();
        }
    }

    /// <summary>Six digits are in the field (typed or pasted).</summary>
    protected virtual void OnCodeCompleted()
    {
    }

    [RelayCommand]
    private async Task ResendAsync()
    {
        if (!Cooldown.IsReady)
        {
            return;
        }

        Notice = null;
        var sent = await RunAsync(() => SendCodeAsync(Email.Trim()));
        Cooldown.Start(sent ? ResendCooldown.AfterSend : ResendCooldown.AfterRateLimit);
        if (sent)
        {
            Code = "";
            Notice = AccountText.CodeSent;
        }

        Tick();
    }

    protected abstract Task SendCodeAsync(string email);

    /// <summary>A wrong or expired code clears the field so the next try starts clean.</summary>
    protected void RejectCode(ApiException e)
    {
        Code = "";
        ErrorMessage = e.Code is ErrorCodes.VerificationInvalid or ErrorCodes.ResetInvalid ? AccountText.CodeInvalid : e.Message;
    }
}

/// <summary>Canvas "Dogrulama": the six-digit code from the email, with resend after a minute.</summary>
public sealed partial class VerifyViewModel(PatikaApiClient api, AccountSession session, INavigationService navigation,
    TimeProvider clock) : CodeEntryViewModel(clock)
{
    protected override Task SendCodeAsync(string email) => api.ResendVerificationAsync(email);

    [RelayCommand]
    private async Task VerifyAsync()
    {
        if (!IsComplete)
        {
            ErrorMessage = AccountText.CodeFormat;
            return;
        }

        if (IsBusy)
        {
            return;
        }

        var signedIn = false;
        IsBusy = true;
        ErrorMessage = null;
        try
        {
            signedIn = await api.VerifyEmailAsync(Email, Code);
        }
        catch (ApiException e)
        {
            RejectCode(e);
            return;
        }
        finally
        {
            IsBusy = false;
            Tick();
        }

        if (signedIn)
        {
            await session.AfterSignInAsync();
            await navigation.GoToAsync(Routes.Map);
            return;
        }

        await navigation.GoToAsync(Routes.SignIn, new Dictionary<string, object> { [Routes.Keys.Email] = Email });
    }

    protected override void OnCodeCompleted()
    {
        // Six digits typed or pasted: verify without another tap.
        if (!IsBusy)
        {
            VerifyCommand.Execute(null);
        }
    }
}

/// <summary>Forgot password: asks for a reset code by email. The API answers the same whether or not the address exists.</summary>
public sealed partial class ForgotPasswordViewModel(PatikaApiClient api, INavigationService navigation) : ViewModelBase
{
    [ObservableProperty]
    public partial string Email { get; set; } = "";

    public void ApplyQuery(IDictionary<string, object> query)
    {
        if (query.TryGetValue(Routes.Keys.Email, out var email) && email is string value)
        {
            Email = value;
        }
    }

    [RelayCommand]
    private async Task SendAsync()
    {
        if (string.IsNullOrWhiteSpace(Email))
        {
            ErrorMessage = "E-postanı yaz.";
            return;
        }

        var email = Email.Trim();
        if (await RunAsync(() => api.SendAsync<ForgotPasswordAcceptedResponse>(HttpMethod.Post, "auth/forgot",
                new ForgotPasswordRequest(email), AuthMode.None)))
        {
            await navigation.GoToAsync(AccountRoutes.ResetPassword, new Dictionary<string, object> { [Routes.Keys.Email] = email });
        }
    }
}

/// <summary>Reset with the six-digit code and a new password; afterwards the user signs in with it.</summary>
public sealed partial class ResetPasswordViewModel(PatikaApiClient api, INavigationService navigation, TimeProvider clock)
    : CodeEntryViewModel(clock)
{
    [ObservableProperty]
    public partial string NewPassword { get; set; } = "";

    protected override Task SendCodeAsync(string email) =>
        api.SendAsync<ForgotPasswordAcceptedResponse>(HttpMethod.Post, "auth/forgot", new ForgotPasswordRequest(email), AuthMode.None);

    [RelayCommand]
    private async Task ResetAsync()
    {
        if (!IsComplete)
        {
            ErrorMessage = AccountText.CodeFormat;
            return;
        }

        if (NewPassword.Length < 10)
        {
            ErrorMessage = AccountText.PasswordRule;
            return;
        }

        if (IsBusy)
        {
            return;
        }

        IsBusy = true;
        ErrorMessage = null;
        try
        {
            await api.SendAsync<object>(HttpMethod.Post, "auth/reset",
                new ResetPasswordRequest(Email.Trim(), Code, NewPassword), AuthMode.None);
        }
        catch (ApiException e)
        {
            RejectCode(e);
            return;
        }
        finally
        {
            IsBusy = false;
            Tick();
        }

        NewPassword = "";
        await navigation.GoToAsync(Routes.SignIn, new Dictionary<string, object>
        {
            [Routes.Keys.Email] = Email.Trim(),
            [AccountRoutes.NoticeKey] = AccountText.PasswordChanged,
        });
    }
}
