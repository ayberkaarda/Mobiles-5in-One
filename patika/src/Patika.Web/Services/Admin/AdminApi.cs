using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Patika.Contracts.Admin;

namespace Patika.Web.Services.Admin;

public sealed class AdminApi(IHttpClientFactory clients, IHttpContextAccessor accessor)
{
    public async Task<T> GetAsync<T>(string path, CancellationToken ct) =>
        (await SendAsync<T>(HttpMethod.Get, path, null, null, ct))!;

    public async Task<T?> PostAsync<T>(string path, object body, CancellationToken ct, string? step = null) =>
        await SendAsync<T>(HttpMethod.Post, path, JsonContent.Create(body), step, ct);

    public async Task<T> CsvAsync<T>(string path, IFormFile file, string? hash, string? step, CancellationToken ct)
    {
        using var multipart = new MultipartFormDataContent();
        using var stream = file.OpenReadStream();
        multipart.Add(new StreamContent(stream), "file", "places.csv");
        if (hash is not null) multipart.Add(new StringContent(hash), "previewHash");
        return (await SendAsync<T>(HttpMethod.Post, path, multipart, step, ct))!;
    }

    public async Task<string> StepAsync(string code, string reason, string action, string target, CancellationToken ct)
    {
        if (reason.Trim().Length is < 10 or > 300 || code.Length != 6 || !code.All(char.IsAsciiDigit))
            throw new AdminApiException(400, "step_invalid");
        return (await PostAsync<StepUpResponse>("/admin/step-up", new StepUpRequest(code, reason.Trim(), action, target), ct))!.StepUpToken;
    }

    private async Task<T?> SendAsync<T>(HttpMethod method, string path, HttpContent? content, string? step, CancellationToken ct)
    {
        using var client = clients.CreateClient("PatikaAdmin");
        // The browser address and the BFF key are added by BffClientAddressHandler on the PatikaAdmin client.
        using var request = new HttpRequestMessage(method, "v1" + path) { Content = content };
        var ticket = await accessor.HttpContext!.AuthenticateAsync(AdminSession.Scheme);
        var token = ticket.Properties?.GetTokenValue("access_token");
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (step is not null) request.Headers.Add("X-Step-Up", step);
        using var response = await client.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            string? code = null;
            if (response.Content.Headers.ContentType?.MediaType is "application/problem+json" or "application/json")
            {
                using var problem = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
                if (problem.RootElement.TryGetProperty("code", out var value)) code = value.GetString();
            }
            throw new AdminApiException((int)response.StatusCode, code);
        }
        return response.StatusCode == System.Net.HttpStatusCode.NoContent ? default : await response.Content.ReadFromJsonAsync<T>(ct);
    }
}

public sealed class AdminApiException(int status, string? code) : Exception("Yönetim isteği tamamlanamadı.")
{
    public int Status { get; } = status;
    public string? Code { get; } = code;
    public string Turkish => Code switch
    {
        "mfa_required" => "Yönetim alanına girmek için uygulamada iki adımlı doğrulamayı etkinleştir.",
        "target_mfa_required" => "Bu kullanıcı önce uygulamada iki adımlı doğrulamayı etkinleştirmeli.",
        "step_up_required" or "step_invalid" or "step_up_invalid" => "6 haneli kodu ve 10–300 karakterlik gerekçeni girerek kimliğini yeniden doğrula.",
        "totp_invalid" => "Doğrulama kodu geçersiz, kullanılmış veya deneme sınırına ulaşıldı. Yeni kodu bekleyip tekrar dene.",
        "mfa_invalid" => "Doğrulama oturumunun süresi doldu. E-posta ve şifrenle yeniden başla.",
        "account_suspended" => "Hesabın askıya alınmış. Yönetim oturumu kapatıldı.",
        "admin_access_revoked" => "Yönetim yetkin değişti. Lütfen yeniden giriş yap.",
        "last_admin_protected" => "Son etkin yöneticinin yetkisi kaldırılamaz.",
        "own_account_protected" => "Bu işlemi kendi hesabında yapamazsın.",
        "suspension_invalid" => "Askı bitişi gelecekte olmalı; mevcut askı kısaltılamaz. Kaldırmak için Askıyı kaldır işlemini seç.",
        "preview_hash_mismatch" => "Dosya önizlemeden sonra değişmiş. Yeniden önizle.",
        "csv_rows_invalid" or "csv_invalid" => "CSV dosyasındaki hataları düzeltip yeniden önizle.",
        "transition_invalid" => "İçeriğin durumu değişmiş. Kuyruğu yenile.",
        _ when Status == 429 => "Çok fazla deneme yapıldı. Bir süre bekleyip tekrar dene.",
        _ when Status == 409 => "İşlem mevcut durumda yapılamıyor. Sayfayı yenileyip tekrar dene.",
        _ when Status == 401 => "Giriş bilgileri veya doğrulama kodu geçersiz. Yeniden dene.",
        _ => "İşlem tamamlanamadı. Bilgileri kontrol edip tekrar dene."
    };
}

