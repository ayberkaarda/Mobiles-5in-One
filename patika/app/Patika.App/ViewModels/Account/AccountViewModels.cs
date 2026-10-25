using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Mvvm;
using Patika.App.Core.Navigation;
using Patika.App.Services;

namespace Patika.App.ViewModels.Account;

/// <summary>Canvas "Giris": email and password, sign-up link, guest map.</summary>
public sealed partial class SignInViewModel(PatikaApiClient api, INavigationService navigation, SessionCoordinator session)
    : ViewModelBase, IQueryAttributable
{
    [ObservableProperty]
    public partial string Email { get; set; } = "";

    [ObservableProperty]
    public partial string Password { get; set; } = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasNotice))]
    public partial string? Notice { get; set; }

    public bool HasNotice => Notice is { Length: > 0 };

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue(Routes.Keys.Email, out var email) && email is string value)
        {
            Email = value;
        }
    }

    public void OnAppearing()
    {
        Notice = session.LastNotice;
        session.LastNotice = null;
    }

    [RelayCommand]
    private async Task SignInAsync()
    {
        if (string.IsNullOrWhiteSpace(Email) || Password.Length == 0)
        {
            ErrorMessage = "E-posta ve şifreni yaz.";
            return;
        }

        if (await RunAsync(() => api.SignInAsync(Email, Password)))
        {
            Password = "";
            Notice = null;
            await navigation.GoToAsync(Routes.Map);
        }
    }

    [RelayCommand]
    private Task SignUpAsync() => navigation.GoToAsync(Routes.SignUp);

    [RelayCommand]
    private Task BrowseAsGuestAsync() => navigation.GoToAsync(Routes.Map);
}

/// <summary>Registration form; the next step is the verification code from the email.</summary>
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
        if (string.IsNullOrWhiteSpace(DisplayName) || string.IsNullOrWhiteSpace(Email) || Password.Length < 10)
        {
            ErrorMessage = "Adını ve e-postanı yaz; şifre en az 10 karakter olmalı.";
            return;
        }

        if (await RunAsync(() => api.RegisterAsync(Email.Trim(), Password, DisplayName.Trim())))
        {
            Password = "";
            await navigation.GoToAsync(Routes.Verify, new Dictionary<string, object> { [Routes.Keys.Email] = Email.Trim() });
        }
    }
}

/// <summary>Canvas "Dogrulama": the code from the email. Verification starts the session when the API returns tokens.</summary>
public sealed partial class VerifyViewModel(PatikaApiClient api, INavigationService navigation) : ViewModelBase, IQueryAttributable
{
    [ObservableProperty]
    public partial string Email { get; set; } = "";

    [ObservableProperty]
    public partial string Code { get; set; } = "";

    [ObservableProperty]
    public partial string? Notice { get; set; }

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue(Routes.Keys.Email, out var email) && email is string value)
        {
            Email = value;
        }
    }

    [RelayCommand]
    private async Task VerifyAsync()
    {
        if (Code.Trim() is not { Length: 6 } digits || !digits.All(char.IsAsciiDigit))
        {
            ErrorMessage = "E-postadaki 6 haneli kodu yaz.";
            return;
        }

        var signedIn = false;
        if (await RunAsync(async () => signedIn = await api.VerifyEmailAsync(Email, Code)))
        {
            await navigation.GoToAsync(signedIn ? Routes.Map : Routes.SignIn,
                signedIn ? null : new Dictionary<string, object> { [Routes.Keys.Email] = Email });
        }
    }

    [RelayCommand]
    private async Task ResendAsync()
    {
        if (await RunAsync(() => api.ResendVerificationAsync(Email)))
        {
            Notice = "Yeni kod gönderildi. E-postanı kontrol et.";
        }
    }
}

/// <summary>Profile header from /me and sign-out. Stats and badges come with package D and the /me additions.</summary>
public sealed partial class ProfileViewModel(PatikaApiClient api) : ViewModelBase
{
    [ObservableProperty]
    public partial string DisplayName { get; set; } = "";

    public async Task LoadAsync()
    {
        if (api.Tokens.UserId is null && api.Tokens.CurrentAccessToken is null)
        {
            DisplayName = "Misafir";
            return;
        }

        await RunAsync(async () => DisplayName = (await api.GetMeAsync()).DisplayName);
    }

    [RelayCommand]
    private Task SignOutAsync() => RunAsync(() => api.SignOutAsync());
}
