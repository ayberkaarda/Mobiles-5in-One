using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Patika.Contracts.Admin;
using Patika.Web.Services.Admin;

namespace Patika.Web.Areas.Admin.Pages;

public sealed class AuditModel(AdminApi api) : AdminPage(api)
{
    [BindProperty(SupportsGet = true)] public string? Actor { get; set; }
    [BindProperty(SupportsGet = true)] public string? Action { get; set; }
    [BindProperty(SupportsGet = true)] public string? Target { get; set; }
    [BindProperty(SupportsGet = true)] public string? From { get; set; }
    [BindProperty(SupportsGet = true)] public string? To { get; set; }
    [BindProperty(SupportsGet = true)] public string? Cursor { get; set; }
    public AdminPage<AdminAudit> Entries { get; set; } = new([], null);
    public async Task OnGetAsync(CancellationToken ct) => Entries = await Api.GetAsync<AdminPage<AdminAudit>>(QueryHelpers.AddQueryString("/admin/audit",
        new Dictionary<string, string?> { ["actor"] = Empty(Actor), ["action"] = Empty(Action), ["target"] = Empty(Target), ["from"] = DateFilter(From), ["to"] = DateFilter(To), ["cursor"] = Cursor }), ct);
    private static string? Empty(string? text) => string.IsNullOrWhiteSpace(text) ? null : text;
    private static string? DateFilter(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (!DateTimeOffset.TryParseExact(text, "yyyy-MM-ddTHH:mm", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
            throw new AdminApiException(400, "audit_query_invalid");
        return parsed.ToString("O", CultureInfo.InvariantCulture);
    }
}
