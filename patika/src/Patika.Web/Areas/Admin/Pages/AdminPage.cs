using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Patika.Web.Services.Admin;

namespace Patika.Web.Areas.Admin.Pages;

public abstract class AdminPage(AdminApi api) : PageModel
{
    protected AdminApi Api { get; } = api;
    public string? Error { get; set; }
    [TempData] public string? Notice { get; set; }
    /// <summary>Reloads the page data after a refused POST so the form is shown with its list, not an empty page.</summary>
    protected virtual Task LoadAsync(CancellationToken ct) => Task.CompletedTask;

    private async Task ReloadAfterFailureAsync(CancellationToken ct)
    {
        try { await LoadAsync(ct); }
        catch (Exception ex) when (ex is AdminApiException or HttpRequestException or TaskCanceledException) { }
    }

    public override async Task OnPageHandlerExecutionAsync(PageHandlerExecutingContext context, PageHandlerExecutionDelegate next)
    {
        try
        {
            var executed = await next();
            if (executed.Exception is not null && !executed.ExceptionHandled)
            {
                if (executed.Exception is AdminApiException failure)
                {
                    executed.ExceptionHandled = true;
                    Error = failure.Turkish;
                    if ((failure.Status == 401 && User.Identity?.IsAuthenticated == true)
                        || failure.Code is "admin_access_revoked" or "account_suspended")
                    {
                        await HttpContext.SignOutAsync(AdminSession.Scheme);
                        TempData["AdminError"] = failure.Turkish;
                        executed.Result = Redirect("/admin/giris?ended=1");
                    }
                    else
                    {
                        if (HttpMethods.IsPost(Request.Method)) await ReloadAfterFailureAsync(HttpContext.RequestAborted);
                        executed.Result = Page();
                    }
                }
                else if (executed.Exception is HttpRequestException or TaskCanceledException)
                {
                    executed.ExceptionHandled = true;
                    Error = "Sunucuya ulaşılamadı. Lütfen tekrar dene.";
                    executed.Result = Page();
                }
            }
        }
        finally
        {
            ModelState.Remove("Password");
            ModelState.Remove("Code");
            ModelState.Remove("RecoveryCode");
        }
    }
}
