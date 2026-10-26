using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Patika.Contracts.Auth;
using Patika.Web.Services.Admin;

namespace Patika.Web.Areas.Admin.Pages;

public sealed class LoginModel(AdminApi api, IMemoryCache cache, TimeProvider clock) : AdminPage(api)
{
    [BindProperty] public string Email { get; set; } = "";
    [BindProperty] public string Password { get; set; } = "";
    [BindProperty] public new string Challenge { get; set; } = "";
    [BindProperty] public string Code { get; set; } = "";
    [BindProperty] public string? RecoveryCode { get; set; }
    public bool NeedsEnrolment { get; set; }
    public void OnGet(bool ended = false)
    {
        Error = TempData["AdminError"] as string;
        if (ended && Error is null) Error = "Yönetim oturumu sona erdi veya yetkin değişti. Lütfen yeniden giriş yap.";
    }

    public async Task<IActionResult> OnPostAsync(CancellationToken ct)
    {
        TokenResponse? tokens;
        if (Challenge.Length > 0)
        {
            if (!cache.TryGetValue<PendingLogin>("admin-login:" + Challenge, out var pending) || pending is null || pending.Expires <= clock.GetUtcNow())
            {
                Challenge = "";
                Error = "Doğrulama süresi doldu. Yeniden giriş yap.";
                return Page();
            }
            tokens = await Api.PostAsync<TokenResponse>("/auth/mfa", new MfaRequest(pending.Token,
                string.IsNullOrWhiteSpace(RecoveryCode) ? Code : null, RecoveryCode), ct);
            cache.Remove("admin-login:" + Challenge);
            Challenge = "";
        }
        else
        {
            var login = await Api.PostAsync<System.Text.Json.JsonElement>("/auth/login", new LoginRequest(Email, Password), ct);
            Password = "";
            if (login.TryGetProperty("mfaRequired", out var mfa) && mfa.GetBoolean())
            {
                Challenge = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
                cache.Set("admin-login:" + Challenge, new PendingLogin(login.GetProperty("mfaToken").GetString()!, clock.GetUtcNow().AddMinutes(5)), TimeSpan.FromMinutes(5));
                return Page();
            }
            tokens = login.Deserialize<TokenResponse>(new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        }
        var principal = AdminSession.Principal(tokens!.AccessToken);
        if (!AdminSession.Allowed(principal))
        {
            await Api.PostAsync<object>("/auth/logout", new LogoutRequest(tokens.RefreshToken), ct);
            NeedsEnrolment = principal.IsInRole("Moderator") || principal.IsInRole("Admin");
            Error = NeedsEnrolment ? "Uygulamada iki adımlı doğrulamayı etkinleştirip yeniden giriş yap." : "Bu hesap yönetim alanına erişemez.";
            return Page();
        }
        ((ClaimsIdentity)principal.Identity!).AddClaim(new Claim(AdminSession.Issued, clock.GetUtcNow().ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)));
        var properties = new AuthenticationProperties { IsPersistent = false, AllowRefresh = true };
        AdminSession.Store(properties, tokens, clock);
        await HttpContext.SignInAsync(AdminSession.Scheme, principal, properties);
        return Redirect("/admin");
    }

    private sealed record PendingLogin(string Token, DateTimeOffset Expires);
}

