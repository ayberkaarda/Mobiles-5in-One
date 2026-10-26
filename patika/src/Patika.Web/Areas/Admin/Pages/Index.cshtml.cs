using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Patika.Contracts.Admin;
using Patika.Web.Services.Admin;

namespace Patika.Web.Areas.Admin.Pages;

public sealed class IndexModel(AdminApi api) : AdminPage(api)
{
    [BindProperty(SupportsGet = true)] public string Type { get; set; } = "adoption";
    [BindProperty(SupportsGet = true)] public string? Cursor { get; set; }
    [BindProperty(SupportsGet = true)] public Guid? Selected { get; set; }
    [BindProperty] public Guid TargetId { get; set; }
    [BindProperty] public string TargetType { get; set; } = "";
    [BindProperty] public string Decision { get; set; } = "";
    [BindProperty] public string? Reason { get; set; }
    [BindProperty] public string Code { get; set; } = "";
    [BindProperty] public string StepReason { get; set; } = "";
    public AdminPage<AdminQueueItem> Queue { get; set; } = new([], null);
    public AdminQueueItem? Item => Queue.Items.FirstOrDefault(x => x.Id == Selected) ?? Queue.Items.FirstOrDefault();
    public Task OnGetAsync(CancellationToken ct) => LoadAsync(ct);
    protected override async Task LoadAsync(CancellationToken ct) => Queue = await Api.GetAsync<AdminPage<AdminQueueItem>>(
        QueryHelpers.AddQueryString("/admin/queue", new Dictionary<string, string?> { ["type"] = Type, ["cursor"] = Cursor }), ct);
    public async Task<IActionResult> OnPostAsync(CancellationToken ct)
    {
        Selected ??= TargetId;
        string? step = null;
        if (TargetId == Guid.Empty || TargetType is not ("adoption" or "urgent" or "photo" or "report")
            || Decision is not ("Approved" or "Rejected" or "Hidden" or "Restored") || Reason?.Length > 500)
            throw new AdminApiException(400, "decision_invalid");
        if (TargetType == "urgent" && Decision == "Restored")
            step = await Api.StepAsync(Code, StepReason, StepUpActions.RestoreUrgent, TargetId.ToString(), ct);
        await Api.PostAsync<object>("/admin/decisions", new AdminDecisionRequest(TargetType, TargetId, Decision, Reason), ct, step);
        Notice = "Karar kaydedildi.";
        return RedirectToPage(new { Type });
    }
}
