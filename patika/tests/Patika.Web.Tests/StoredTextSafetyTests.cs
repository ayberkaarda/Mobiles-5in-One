extern alias Api;

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Patika.Contracts.Admin;
using Patika.Contracts.Auth;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Patika.Contracts.Urgent;
using Patika.Domain;
using Patika.Web.Seo.Documents;
using Patika.Web.Services.Admin;
using Patika.Web.Tests.Admin;
using Xunit;
using Mail = Api::Patika.Api.Email;
using Media = Api::Patika.Api.Features.Media;

namespace Patika.Web.Tests;

public sealed class StoredTextSafetyTests(AdminFlowFixture fixture) : IClassFixture<AdminFlowFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("\"><img src=x onerror=alert(1)>")]
    [InlineData("javascript:alert(1)")]
    [InlineData("</title><script>")]
    [InlineData("</script><script>")]
    [InlineData("visible\u202e\u0001\u2066\u007ftext")]
    public async Task ApiStoredTextStaysInertAcrossPublicAdminSeoAndJson(string payload)
    {
        var mail = new Mailbox();
        await using var flow = new AdminFlow(fixture, services =>
        {
            services.RemoveAll<Mail.IEmailSender>();
            services.AddSingleton<Mail.IEmailSender>(mail);
            services.RemoveAll<Media.IUploadLedger>();
            services.AddSingleton<Media.IUploadLedger, UploadedPhoto>();
        });
        var text = payload + " sample";
        var clean = UserText.Clean(text);
        var email = $"sweep.{Guid.NewGuid():N}@example.org";
        using var author = flow.Api.CreateClient();
        using (var registration = await author.PostAsJsonAsync("/v1/auth/register", new RegisterRequest(email, AdminFlow.Password, text), Ct))
            Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);
        var code = Regex.Match(Assert.Single(mail.Messages).Body, @"\n\n(\d{6})\n").Groups[1].Value;
        using (var verification = await author.PostAsJsonAsync("/v1/auth/verify-email", new VerifyEmailRequest(email, code), Ct))
        {
            verification.EnsureSuccessStatusCode();
            var tokens = (await verification.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
            author.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.AccessToken);
        }
        var location = new CoordinateDto(41, 29);
        var animal = await CreateAsync(author, "/v1/animals", new AnimalRequest(location, "Cat", "Unknown", "Healthy", text, District: "Kadıköy"));
        var animalId = animal.GetProperty("id").GetGuid();
        var adoption = await CreateAsync(author, $"/v1/animals/{animalId}/adoption", new { description = text, requirements = text, district = "Kadıköy" });
        var adoptionId = adoption.GetProperty("id").GetGuid();
        var station = await CreateAsync(author, "/v1/stations", new StationRequest(location, "Food", "Cat", $"station/{Guid.NewGuid()}", text, "Kadıköy"));
        var stationId = station.GetProperty("id").GetGuid();
        await CreateAsync(author, $"/v1/stations/{stationId}/feedings", new FeedingRequest(Note: text));
        await CreateAsync(author, $"/v1/animals/{animalId}/sightings", new SightingRequest(text));
        var urgent = await CreateAsync(author, "/v1/urgent", new CreateUrgentPostRequest(location, "Other", text, $"urgent/{Guid.NewGuid()}"));
        var urgentId = urgent.GetProperty("id").GetGuid();
        var report = await CreateAsync(author, "/v1/reports", new { targetType = "animal", targetId = animalId, reason = text });
        var reportId = report.GetProperty("id").GetGuid();

        var admin = await flow.UserAsync();
        using var login = await flow.LoginAsync(admin);
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        using var api = AdminClient(flow, login);
        foreach (var path in new[] { $"/admin?type=adoption&selected={adoptionId}", $"/admin?type=urgent&selected={urgentId}", $"/admin?type=report&selected={reportId}" })
        {
            var html = await flow.Browser.GetStringAsync(path, Ct);
            AssertInertHtml(html);
            Assert.Contains(WebUtility.HtmlEncode(clean), html, StringComparison.Ordinal);
        }
        // The audit reason is written through the moderation API, in the same transaction as publication.
        await CreateAsync(api, "/v1/admin/decisions", new AdminDecisionRequest("adoption", adoptionId, "Approved", text));

        var csvName = text + " " + Guid.NewGuid().ToString("N")[..6];
        var website = "https://example.org/?q=" + Uri.EscapeDataString(text);
        var csv = "name,kind,latitude,longitude,address,phone,open24h,district,website\n"
            + string.Join(',', new[] { csvName, "Vet", "41", "29", text, "", "true", "Kadıköy", website }.Select(CsvCell));
        var preview = await CsvAsync(api, csv);
        Assert.All(preview.GetProperty("rows").EnumerateArray(), row => Assert.Equal("valid", row.GetProperty("status").GetString()));
        var hash = preview.GetProperty("previewHash").GetString()!;
        flow.Clock.Now = flow.Clock.Now.AddSeconds(30);
        var step = await CreateAsync(api, "/v1/admin/step-up", new StepUpRequest(flow.Code, text + " audit", StepUpActions.CsvCommit, hash));
        await CsvAsync(api, csv, hash, step.GetProperty("stepUpToken").GetString());
        // A URL using an executable scheme is rejected instead of being stored.
        var invalid = await CsvAsync(api, csv.Replace(website, "javascript:alert(1)", StringComparison.Ordinal));
        Assert.All(invalid.GetProperty("rows").EnumerateArray(), row => Assert.Equal("error", row.GetProperty("status").GetString()));

        await using var db = flow.Context();
        var post = await db.AdoptionPosts.SingleAsync(p => p.Id == adoptionId, Ct);
        var place = await db.CarePlaces.SingleAsync(p => p.Name == UserText.Clean(csvName), Ct);
        Assert.Equal(clean.Trim(), post.Description);
        Assert.Equal(clean.Trim(), post.Requirements);
        Assert.Equal(clean, (await db.Animals.SingleAsync(a => a.Id == animalId, Ct)).Name);
        Assert.Equal(clean, (await db.Users.SingleAsync(u => u.Email == email, Ct)).DisplayName);
        Assert.Equal(clean, (await db.Feedings.SingleAsync(f => f.StationId == stationId, Ct)).Note);
        Assert.Equal(clean.Trim(), (await db.UrgentPosts.SingleAsync(u => u.Id == urgentId, Ct)).Description);
        Assert.Equal(clean.Trim(), (await db.Reports.SingleAsync(r => r.Id == reportId, Ct)).Reason);
        Assert.Equal(clean.Trim(), place.Address);
        Assert.Contains(await db.AuditLogs.Where(a => a.TargetId == adoptionId).Select(a => a.DetailsJson).ToListAsync(Ct), details =>
            details is not null && JsonDocument.Parse(details).RootElement.GetProperty("reason").GetString() == clean.Trim());

        foreach (var path in new[] { $"/v1/animals/{animalId}", $"/v1/animals/{animalId}/sightings", $"/v1/adoptions/{adoptionId}", $"/v1/stations/{stationId}",
            $"/v1/stations/{stationId}/feedings", $"/v1/urgent/{urgentId}", "/v1/me" })
        {
            var json = await author.GetStringAsync(path, Ct);
            Assert.DoesNotContain("<", json, StringComparison.Ordinal);
            using var document = JsonDocument.Parse(json);
            Assert.Contains(StringValues(document.RootElement), value => value.Contains(clean, StringComparison.Ordinal));
        }
        foreach (var path in new[] { "/v1/admin/queue?type=report", "/v1/admin/queue?type=urgent", $"/v1/admin/audit?target={adoptionId}", $"/v1/admin/users?q={Uri.EscapeDataString(email)}" })
        {
            var json = await api.GetStringAsync(path, Ct);
            Assert.DoesNotContain("<", json, StringComparison.Ordinal);
            Assert.DoesNotContain("\u202e", json, StringComparison.Ordinal);
        }
        using var publicClient = flow.Web.CreateClient();
        var paths = new List<string> { "/", "/sahiplendirme", "/sahiplendirme?il=istanbul", "/sahiplendirme?ilce=kadikoy",
            $"/sahiplendirme/{post.Slug}", "/istasyonlar/istanbul", "/istasyonlar/istanbul/kadikoy", "/bakim-yerleri",
            $"/bakim-yeri/{place.Slug}", "/etki", "/rehber", "/hakkinda", "/sss", "/gizlilik", "/kvkk", "/hesap-silme", "/iletisim", "/kosullar", "/404" };
        paths.AddRange(flow.Web.Services.GetRequiredService<DocumentStore>().List("rehber").Select(d => "/rehber/" + d.Slug));
        foreach (var path in paths)
        {
            using var response = await publicClient.GetAsync(path, Ct);
            Assert.Equal(path == "/404" ? HttpStatusCode.NotFound : HttpStatusCode.OK, response.StatusCode);
            AssertInertHtml(await response.Content.ReadAsStringAsync(Ct));
        }
        var detail = await publicClient.GetStringAsync($"/sahiplendirme/{post.Slug}", Ct);
        Assert.Contains(WebUtility.HtmlEncode(clean), detail, StringComparison.Ordinal);
        var careHtml = await publicClient.GetStringAsync($"/bakim-yeri/{place.Slug}", Ct);
        Assert.Contains(WebUtility.HtmlEncode(clean), careHtml, StringComparison.Ordinal);
        Assert.Contains("application/ld+json", careHtml, StringComparison.Ordinal);
        Assert.Contains("property=\"og:title\"", detail, StringComparison.Ordinal);
        if (clean.Contains('<')) Assert.Contains("\\u003C", careHtml, StringComparison.OrdinalIgnoreCase);
        foreach (var path in new[] { "/admin/csv", $"/admin/kullanicilar?q={Uri.EscapeDataString(email)}", "/admin/denetim", "/admin/cikis", "/admin/giris" })
            AssertInertHtml(await flow.Browser.GetStringAsync(path, Ct));

        var sitemap = XDocument.Parse(await publicClient.GetStringAsync("/sitemap.xml", Ct));
        foreach (var loc in sitemap.Descendants().Where(e => e.Name.LocalName == "loc"))
        {
            var xml = await publicClient.GetStringAsync(new Uri(loc.Value).PathAndQuery, Ct);
            XDocument.Parse(xml);
            Assert.DoesNotContain("<script", xml, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("<img", xml, StringComparison.OrdinalIgnoreCase);
        }
    }

    private static void AssertInertHtml(string html)
    {
        Assert.DoesNotContain("<script>alert", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<img src=x", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("</title><script>", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("href=\"javascript:", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\u202e", html, StringComparison.Ordinal);
        Assert.DoesNotContain("\u0001", html, StringComparison.Ordinal);
        // No executable script at all: CSP is script-src 'self' without a nonce, so only data blocks may be inline.
        Assert.All(Regex.Matches(html, @"<script\b[^>]*>", RegexOptions.IgnoreCase), tag =>
            Assert.Equal("<script type=\"application/ld+json\">", tag.Value));
        foreach (Match block in Regex.Matches(html, "<script[^>]*type=\"application/ld\\+json\"[^>]*>(.*?)</script>", RegexOptions.Singleline))
        {
            Assert.DoesNotContain("<", block.Groups[1].Value, StringComparison.Ordinal);
            using var document = JsonDocument.Parse(block.Groups[1].Value);
            Assert.Equal(JsonValueKind.Object, document.RootElement.ValueKind);
        }
    }

    private static async Task<JsonElement> CreateAsync(HttpClient client, string path, object body)
    {
        using var response = await client.PostAsJsonAsync(path, body, Ct);
        var json = await response.Content.ReadAsStringAsync(Ct);
        Assert.True(response.IsSuccessStatusCode, $"{path}: {(int)response.StatusCode} {json}");
        Assert.DoesNotContain("<", json, StringComparison.Ordinal);
        return json.Length == 0 ? default : JsonDocument.Parse(json).RootElement.Clone();
    }

    private static IEnumerable<string> StringValues(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => [value.GetString()!],
        JsonValueKind.Array => value.EnumerateArray().SelectMany(StringValues),
        JsonValueKind.Object => value.EnumerateObject().SelectMany(p => StringValues(p.Value)),
        _ => []
    };

    private static string CsvCell(string value) => "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private static async Task<JsonElement> CsvAsync(HttpClient api, string csv, string? hash = null, string? step = null)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(csv)), "file", "places.csv");
        if (hash is not null) form.Add(new StringContent(hash), "previewHash");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/admin/care-places/csv/" + (hash is null ? "preview" : "commit")) { Content = form };
        if (step is not null) request.Headers.Add("X-Step-Up", step);
        using var response = await api.SendAsync(request, Ct);
        var json = await response.Content.ReadAsStringAsync(Ct);
        Assert.True(response.IsSuccessStatusCode, json);
        Assert.DoesNotContain("<", json, StringComparison.Ordinal);
        return json.Length == 0 ? default : JsonDocument.Parse(json).RootElement.Clone();
    }

    private static HttpClient AdminClient(AdminFlow flow, HttpResponseMessage login)
    {
        var cookie = login.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("PatikaAdmin=", StringComparison.Ordinal));
        var options = flow.Web.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(AdminSession.Scheme);
        var ticket = options.TicketDataFormat.Unprotect(cookie["PatikaAdmin=".Length..].Split(';')[0])!;
        var client = flow.Api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ticket.Properties.GetTokenValue("access_token"));
        return client;
    }

    private sealed class Mailbox : Mail.IEmailSender
    {
        public List<Mail.EmailMessage> Messages { get; } = [];
        public Task SendAsync(Mail.EmailMessage message, CancellationToken cancellationToken)
        {
            Messages.Add(message);
            return Task.CompletedTask;
        }
    }

    private sealed class UploadedPhoto : Media.IUploadLedger
    {
        public Task<int?> TryReserveAsync(Media.UploadReservation upload, DateTimeOffset dayStart, int limit, CancellationToken cancellationToken) => Task.FromResult<int?>(limit - 1);
        public Task<bool> IsUsableByAsync(Guid userId, string photoKey, CancellationToken cancellationToken) => Task.FromResult(true);
    }
}
