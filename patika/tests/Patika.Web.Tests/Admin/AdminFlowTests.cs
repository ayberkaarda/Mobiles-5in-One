using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Patika.Contracts.Admin;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Web.Services.Admin;
using Xunit;

namespace Patika.Web.Tests.Admin;

public sealed class AdminFlowTests(AdminFlowFixture fixture) : IClassFixture<AdminFlowFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task PasswordThenTotpEntersQueueWithPrivateCookieAndNoTokenDisclosure()
    {
        await using var flow = new AdminFlow(fixture);
        var user = await flow.UserAsync();
        using var password = await flow.PasswordAsync(user);
        var html = await password.Content.ReadAsStringAsync(Ct);
        Assert.Contains("Doğrulama kodu", html, StringComparison.Ordinal);
        Assert.DoesNotContain("mfaToken", html, StringComparison.Ordinal);
        Assert.DoesNotContain("accessToken", html, StringComparison.Ordinal);
        Assert.False(password.Headers.TryGetValues("Set-Cookie", out var firstCookies) && firstCookies.Any(c => c.StartsWith("PatikaAdmin=", StringComparison.Ordinal)));
        using var login = await AdminBrowser.PostAsync(flow.Browser, "/admin/giris", new() { ["Challenge"] = AdminBrowser.Field(html, "Challenge"), ["Code"] = flow.Code }, html);
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        Assert.Equal("/admin", login.Headers.Location?.OriginalString);
        var cookie = login.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("PatikaAdmin=", StringComparison.Ordinal));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/admin", cookie, StringComparison.OrdinalIgnoreCase);
        var ticket = Ticket(flow, login);
        var tokens = ticket.Properties.GetTokens().Where(t => t.Name is "access_token" or "refresh_token").Select(t => t.Value).ToArray();
        Assert.Equal(2, tokens.Length);
        foreach (var path in new[] { "/admin", "/admin/csv", "/admin/kullanicilar", "/admin/denetim", "/admin/cikis" })
        {
            using var response = await flow.Browser.GetAsync(path, Ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var body = await response.Content.ReadAsStringAsync(Ct);
            foreach (var token in tokens)
            {
                Assert.DoesNotContain(token, body, StringComparison.Ordinal);
                if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
                    foreach (var other in cookies.Where(c => !c.StartsWith("PatikaAdmin", StringComparison.Ordinal))) Assert.DoesNotContain(token, other, StringComparison.Ordinal);
            }
            Assert.True(response.Headers.CacheControl?.NoStore);
            Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
            Assert.Equal("noindex, nofollow", response.Headers.GetValues("X-Robots-Tag").Single());
        }
    }

    [Theory]
    [InlineData(UserRole.User)]
    [InlineData(UserRole.Moderator)]
    public async Task NormalUserAndModeratorWithoutTotpAreRefused(UserRole role)
    {
        await using var flow = new AdminFlow(fixture);
        var user = await flow.UserAsync(role, false);
        using var login = await flow.PasswordAsync(user);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var body = await login.Content.ReadAsStringAsync(Ct);
        Assert.Contains(role == UserRole.Moderator ? "iki adımlı doğrulamayı etkinleştir" : "yönetim alanına erişemez", body, StringComparison.Ordinal);
        using var queue = await flow.Browser.GetAsync("/admin", Ct);
        Assert.Equal(HttpStatusCode.Redirect, queue.StatusCode);
    }

    [Fact]
    public async Task ModeratorCanModerateButCannotManageUsersAuditOrImports()
    {
        await using var flow = new AdminFlow(fixture);
        using var login = await flow.LoginAsync(await flow.UserAsync(UserRole.Moderator));
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        using var queue = await flow.Browser.GetAsync("/admin", Ct);
        Assert.Equal(HttpStatusCode.OK, queue.StatusCode);
        var html = await queue.Content.ReadAsStringAsync(Ct);
        Assert.DoesNotContain("href=\"/admin/kullanicilar\"", html, StringComparison.Ordinal);
        foreach (var path in new[] { "/admin/kullanicilar", "/admin/denetim", "/admin/csv" })
        {
            using var response = await flow.Browser.GetAsync(path, Ct);
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
    }

    [Fact]
    public async Task AdoptionApprovalDisappearsFromQueueAndWritesAnAuditViaTheApi()
    {
        await using var flow = new AdminFlow(fixture);
        var user = await flow.UserAsync();
        var post = await flow.AdoptionAsync(user.Id, "<script>alert('stored')</script>");
        using var login = await flow.LoginAsync(user);
        var html = await flow.Browser.GetStringAsync($"/admin?selected={post.Id}", Ct);
        Assert.Contains("&lt;script&gt;", html, StringComparison.Ordinal);
        Assert.DoesNotContain("<script>", html, StringComparison.Ordinal);
        using var decision = await AdminBrowser.PostAsync(flow.Browser, "/admin", new()
        {
            ["TargetId"] = post.Id.ToString(),
            ["TargetType"] = "adoption",
            ["Decision"] = "Approved",
            ["Type"] = "adoption"
        }, html);
        Assert.Equal(HttpStatusCode.Redirect, decision.StatusCode);
        using var api = AuthorizedApi(flow, login);
        var queue = await api.GetFromJsonAsync<AdminPage<AdminQueueItem>>("/v1/admin/queue?type=adoption", Ct);
        Assert.DoesNotContain(queue!.Items, item => item.Id == post.Id);
        var audit = await api.GetFromJsonAsync<AdminPage<AdminAudit>>($"/v1/admin/audit?target={post.Id}", Ct);
        Assert.Contains(audit!.Items, item => item.TargetId == post.Id);
    }

    [Fact]
    public async Task UrgentCanBeHiddenAndRestoredWithBoundStepUp()
    {
        await using var flow = new AdminFlow(fixture);
        var user = await flow.UserAsync();
        var post = new UrgentPost { CreatedBy = user.Id, Description = "Urgent help", PhotoKey = "urgent/test", Location = new GeoPoint(29, 41), State = UrgentPostState.Open };
        await using (var db = flow.Context()) { db.UrgentPosts.Add(post); await db.SaveChangesAsync(Ct); }
        using var login = await flow.LoginAsync(user);
        using var hide = await AdminBrowser.PostAsync(flow.Browser, "/admin?type=urgent", new()
        {
            ["TargetId"] = post.Id.ToString(),
            ["TargetType"] = "urgent",
            ["Decision"] = "Hidden",
            ["Type"] = "urgent",
            ["Reason"] = "Duplicate urgent request"
        });
        Assert.Equal(HttpStatusCode.Redirect, hide.StatusCode);
        await using (var db = flow.Context()) Assert.NotNull((await db.UrgentPosts.IgnoreQueryFilters().SingleAsync(p => p.Id == post.Id, Ct)).HiddenAt);
        flow.Clock.Now = flow.Clock.Now.AddSeconds(30);
        using var restore = await AdminBrowser.PostAsync(flow.Browser, "/admin?type=urgent", new()
        {
            ["TargetId"] = post.Id.ToString(),
            ["TargetType"] = "urgent",
            ["Decision"] = "Restored",
            ["Type"] = "urgent",
            ["StepReason"] = "Verified request is valid",
            ["Code"] = flow.Code
        });
        Assert.Equal(HttpStatusCode.Redirect, restore.StatusCode);
        await using (var db = flow.Context()) Assert.Null((await db.UrgentPosts.IgnoreQueryFilters().SingleAsync(p => p.Id == post.Id, Ct)).HiddenAt);
    }

    [Fact]
    public async Task RoleChangeRequiresFreshCodeAndSuspensionCanBeLifted()
    {
        await using var flow = new AdminFlow(fixture);
        var caller = await flow.UserAsync();
        var target = await flow.UserAsync(UserRole.User);
        using var login = await flow.LoginAsync(caller);
        var fields = new Dictionary<string, string>
        {
            ["Q"] = target.Id.ToString(),
            ["TargetId"] = target.Id.ToString(),
            ["Operation"] = "role",
            ["Role"] = "Moderator",
            ["Reason"] = "Approved community coordinator"
        };
        using var missing = await AdminBrowser.PostAsync(flow.Browser, "/admin/kullanicilar?q=" + target.Id, new(fields));
        Assert.Equal(HttpStatusCode.OK, missing.StatusCode);
        fields["Code"] = flow.Code == "000000" ? "000001" : "000000";
        using var invalid = await AdminBrowser.PostAsync(flow.Browser, "/admin/kullanicilar?q=" + target.Id, new(fields));
        Assert.Equal(HttpStatusCode.OK, invalid.StatusCode);
        var refused = await invalid.Content.ReadAsStringAsync(Ct);
        Assert.Contains("admin-alert", refused, StringComparison.Ordinal);
        Assert.Contains(target.Id.ToString(), refused, StringComparison.Ordinal);
        await using (var db = flow.Context()) Assert.Equal(UserRole.User, (await db.Users.SingleAsync(u => u.Id == target.Id, Ct)).Role);
        flow.Clock.Now = flow.Clock.Now.AddSeconds(30);
        fields["Code"] = flow.Code;
        using var success = await AdminBrowser.PostAsync(flow.Browser, "/admin/kullanicilar?q=" + target.Id, new(fields));
        Assert.Equal(HttpStatusCode.Redirect, success.StatusCode);
        await using (var db = flow.Context()) Assert.Equal(UserRole.Moderator, (await db.Users.SingleAsync(u => u.Id == target.Id, Ct)).Role);
        foreach (var operation in new[] { "suspend", "unsuspend" })
        {
            flow.Clock.Now = flow.Clock.Now.AddSeconds(30);
            fields["Operation"] = operation;
            fields["Code"] = flow.Code;
            using var response = await AdminBrowser.PostAsync(flow.Browser, "/admin/kullanicilar?q=" + target.Id, new(fields));
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        }
        await using (var db = flow.Context()) Assert.Null((await db.Users.SingleAsync(u => u.Id == target.Id, Ct)).SuspendedUntil);
    }

    [Fact]
    public async Task CsvReportsRowErrorsAndCommitsOnlyThePreviewedBytes()
    {
        await using var flow = new AdminFlow(fixture);
        using var login = await flow.LoginAsync(await flow.UserAsync());
        const string header = "name,kind,latitude,longitude,address,phone,open24h\n";
        var csv = header + "Clinic,Vet,41,29,Street,,true\n";
        using var invalid = await CsvAsync(flow, csv + "Bad,Vet,0,0,Street,,true\n");
        var invalidHtml = await invalid.Content.ReadAsStringAsync(Ct);
        Assert.Contains("1 satırda hata var", invalidHtml, StringComparison.Ordinal);
        Assert.Contains("41.0000, 29.0000", invalidHtml, StringComparison.Ordinal);
        Assert.Contains("admin-row-error", invalidHtml, StringComparison.Ordinal);
        using var preview = await CsvAsync(flow, csv);
        var html = await preview.Content.ReadAsStringAsync(Ct);
        var hash = AdminBrowser.Field(html, "PreviewHash");
        flow.Clock.Now = flow.Clock.Now.AddSeconds(30);
        using var commit = await CsvAsync(flow, csv, hash, flow.Code);
        Assert.Equal(HttpStatusCode.Redirect, commit.StatusCode);
        using var api = AuthorizedApi(flow, login);
        var audit = await api.GetFromJsonAsync<AdminPage<AdminAudit>>("/v1/admin/audit?action=care_places.csv_commit", Ct);
        Assert.Contains(audit!.Items, row => row.DetailsJson?.Contains(hash, StringComparison.Ordinal) == true);
    }

    [Fact]
    public async Task AuthenticatedPostStillRequiresAntiforgeryAndLogoutClearsTheSession()
    {
        await using var flow = new AdminFlow(fixture);
        using var login = await flow.LoginAsync(await flow.UserAsync());
        using var missing = await flow.Browser.PostAsync("/admin", new FormUrlEncodedContent(new Dictionary<string, string>()), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        using var logout = await AdminBrowser.PostAsync(flow.Browser, "/admin/cikis", new());
        Assert.Equal(HttpStatusCode.Redirect, logout.StatusCode);
        using var queue = await flow.Browser.GetAsync("/admin", Ct);
        Assert.Equal(HttpStatusCode.Redirect, queue.StatusCode);
    }

    private static AuthenticationTicket Ticket(AdminFlow flow, HttpResponseMessage login)
    {
        var cookie = login.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("PatikaAdmin=", StringComparison.Ordinal));
        var value = cookie["PatikaAdmin=".Length..].Split(';')[0];
        var options = flow.Web.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(AdminSession.Scheme);
        return options.TicketDataFormat.Unprotect(value)!;
    }

    private static HttpClient AuthorizedApi(AdminFlow flow, HttpResponseMessage login)
    {
        var api = flow.Api.CreateClient();
        api.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Ticket(flow, login).Properties.GetTokenValue("access_token"));
        return api;
    }

    private static async Task<HttpResponseMessage> CsvAsync(AdminFlow flow, string csv, string? hash = null, string? code = null)
    {
        var html = await flow.Browser.GetStringAsync("/admin/csv", Ct);
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(AdminBrowser.Field(html, "__RequestVerificationToken")), "__RequestVerificationToken");
        form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(csv)), "File", "places.csv");
        if (hash is not null)
        {
            form.Add(new StringContent("true"), "commit");
            form.Add(new StringContent(hash), "PreviewHash");
            form.Add(new StringContent(code!), "Code");
            form.Add(new StringContent("Verified care place import"), "Reason");
        }
        return await flow.Browser.PostAsync("/admin/csv", form, Ct);
    }
}
