using Microsoft.AspNetCore.Mvc;
using Patika.Contracts.Admin;
using Patika.Web.Services.Admin;

namespace Patika.Web.Areas.Admin.Pages;

[RequestSizeLimit(1_100_000)]
[RequestFormLimits(MultipartBodyLengthLimit = 1_100_000)]
public sealed class CsvModel(AdminApi api) : AdminPage(api)
{
    [BindProperty] public new IFormFile? File { get; set; }
    [BindProperty] public string PreviewHash { get; set; } = "";
    [BindProperty] public string Code { get; set; } = "";
    [BindProperty] public string Reason { get; set; } = "";
    public CarePlacePreview? Preview { get; set; }
    public void OnGet() { }
    public async Task<IActionResult> OnPostAsync(bool commit, CancellationToken ct)
    {
        if (File is null || File.Length is <= 0 or > 1_048_576) throw new AdminApiException(400, "csv_file_required");
        Preview = await Api.CsvAsync<CarePlacePreview>("/admin/care-places/csv/preview", File, null, null, ct);
        if (!commit)
        {
            PreviewHash = Preview.PreviewHash;
            ModelState.Remove(nameof(PreviewHash));
            return Page();
        }
        if (PreviewHash != Preview.PreviewHash) throw new AdminApiException(409, "preview_hash_mismatch");
        if (Preview.Rows.Any(row => row.Status != "valid")) throw new AdminApiException(400, "csv_rows_invalid");
        var step = await Api.StepAsync(Code, Reason, StepUpActions.CsvCommit, Preview.PreviewHash, ct);
        var result = await Api.CsvAsync<CarePlaceCommit>("/admin/care-places/csv/commit", File, Preview.PreviewHash, step, ct);
        Notice = result.AlreadyCommitted ? "Bu dosya daha önce içe aktarılmış." : $"{result.Inserted} bakım yeri içe aktarıldı.";
        return RedirectToPage();
    }
}

