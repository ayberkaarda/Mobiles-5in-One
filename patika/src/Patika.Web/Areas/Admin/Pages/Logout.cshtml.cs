using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Patika.Contracts.Auth;
using Patika.Web.Services.Admin;

namespace Patika.Web.Areas.Admin.Pages;

public sealed class LogoutModel(AdminApi api) : AdminPage(api)
{
    public void OnGet() { }
    public async Task<IActionResult> OnPostAsync(CancellationToken ct)
    {
        var ticket = await HttpContext.AuthenticateAsync(AdminSession.Scheme);
        try
        {
            await Api.PostAsync<object>("/auth/logout", new LogoutRequest(ticket.Properties?.GetTokenValue("refresh_token") ?? ""), ct);
        }
        catch (Exception ex) when (ex is AdminApiException or HttpRequestException or TaskCanceledException) { }
        finally { await HttpContext.SignOutAsync(AdminSession.Scheme); }
        return Redirect("/admin/giris");
    }
}
