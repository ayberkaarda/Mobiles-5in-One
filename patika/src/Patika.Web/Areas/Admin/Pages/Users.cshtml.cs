using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Patika.Contracts.Admin;
using Patika.Web.Services.Admin;

namespace Patika.Web.Areas.Admin.Pages;

public sealed class UsersModel(AdminApi api) : AdminPage(api)
{
    [BindProperty(SupportsGet = true)] public string? Q { get; set; }
    [BindProperty] public Guid TargetId { get; set; }
    [BindProperty] public string Operation { get; set; } = "";
    [BindProperty] public string Role { get; set; } = "";
    [BindProperty] public string? Until { get; set; }
    [BindProperty] public string Reason { get; set; } = "";
    [BindProperty] public string Code { get; set; } = "";
    public IReadOnlyList<AdminUser> Users { get; set; } = [];
    public Task OnGetAsync(CancellationToken ct) => LoadAsync(ct);
    protected override async Task LoadAsync(CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(Q)) return;
        Users = await Api.GetAsync<IReadOnlyList<AdminUser>>(QueryHelpers.AddQueryString("/admin/users", "q", Q), ct);
    }
    public async Task<IActionResult> OnPostAsync(CancellationToken ct)
    {
        var action = Operation switch { "role" => StepUpActions.RoleChange, "suspend" => StepUpActions.Suspend, "unsuspend" => StepUpActions.Unsuspend, _ => null };
        if (TargetId == Guid.Empty || action is null || !ModelState.IsValid) throw new AdminApiException(400, "validation_failed");
        DateTimeOffset? until = null;
        if (Operation == "suspend" && !string.IsNullOrWhiteSpace(Until))
        {
            if (!DateTimeOffset.TryParseExact(Until, "yyyy-MM-ddTHH:mm", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
                throw new AdminApiException(400, "suspension_invalid");
            until = parsed;
        }
        var step = await Api.StepAsync(Code, Reason, action, TargetId.ToString(), ct);
        object body = Operation switch
        {
            "role" => new AdminRoleRequest(Role),
            "suspend" => new AdminSuspendRequest(until, Reason),
            _ => new AdminUnsuspendRequest(Reason)
        };
        await Api.PostAsync<object>($"/admin/users/{TargetId}/{Operation}", body, ct, step);
        Notice = "Kullanıcı işlemi kaydedildi.";
        return RedirectToPage(new { Q });
    }
}
