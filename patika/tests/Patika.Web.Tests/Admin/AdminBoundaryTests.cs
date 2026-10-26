using System.Net;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Patika.Web.Services.Admin;
using Xunit;

namespace Patika.Web.Tests.Admin;

public sealed class AdminBoundaryTests
{
    [Fact]
    public async Task SignedInLayoutHasAClosedNativeMobileMenuBeforeTheContent()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("Cookie", AdminBrowser.Cookie(factory, DateTimeOffset.UtcNow));
        var html = await client.GetStringAsync("/admin/cikis", TestContext.Current.CancellationToken);
        Assert.Contains("<details class=\"admin-menu\">", html, StringComparison.Ordinal);
        Assert.DoesNotContain("<details class=\"admin-menu\" open", html, StringComparison.Ordinal);
        Assert.True(html.IndexOf("<details", StringComparison.Ordinal) < html.IndexOf("<main", StringComparison.Ordinal));
        Assert.DoesNotContain("<script", html, StringComparison.OrdinalIgnoreCase);
    }

    private static WebApplicationFactory<Program> Factory(AdminClock? clock = null, HttpMessageHandler? handler = null) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Database=unused");
        builder.ConfigureLogging(logging => logging.ClearProviders().AddConsole());
        builder.ConfigureServices(services => services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider()));
        if (handler is not null) builder.ConfigureServices(services => services.AddHttpClient("PatikaAdmin").ConfigurePrimaryHttpMessageHandler(() => handler));
        if (clock is not null) builder.ConfigureServices(services => services.Replace(ServiceDescriptor.Singleton<TimeProvider>(clock)));
    });

    [Theory]
    [InlineData("/admin")]
    [InlineData("/admin/giris")]
    [InlineData("/admin/csv")]
    [InlineData("/admin/kullanicilar")]
    [InlineData("/admin/denetim")]
    [InlineData("/admin/cikis")]
    [InlineData("/admin/missing")]
    public async Task EveryAdminResponseHasPrivacyAndFrameHeaders(string path)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        using var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.Equal("noindex, nofollow", response.Headers.GetValues("X-Robots-Tag").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("frame-ancestors 'none'", csp, StringComparison.Ordinal);
        Assert.Contains("script-src 'self'", csp, StringComparison.Ordinal);
        if (path == "/admin/giris") Assert.Contains("name=\"robots\" content=\"noindex\"", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken), StringComparison.Ordinal);
    }

    [Fact]
    public async Task MissingAntiforgeryIsBadRequest()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        using var response = await client.PostAsync("/admin/giris", new FormUrlEncodedContent(new Dictionary<string, string> { ["Email"] = "a@example.org", ["Password"] = "password" }), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Theory]
    [InlineData("Moderator", true, "/admin/kullanicilar")]
    [InlineData("Moderator", true, "/admin/denetim")]
    [InlineData("Moderator", true, "/admin/csv")]
    [InlineData("User", true, "/admin")]
    [InlineData("Moderator", false, "/admin")]
    public async Task RoleAndMfaAreEnforcedBeforeCallingTheApi(string role, bool mfa, string path)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("Cookie", AdminBrowser.Cookie(factory, DateTimeOffset.UtcNow, role, mfa));
        using var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SlidingRenewalsCannotExtendTheAbsoluteEightHourLifetime()
    {
        var clock = new AdminClock();
        var issued = clock.Now;
        await using var factory = Factory(clock);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false, HandleCookies = false });
        var cookie = AdminBrowser.Cookie(factory, issued);
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        for (var minutes = 20; minutes < 480; minutes += 20)
        {
            clock.Now = issued.AddMinutes(minutes);
            using var renewed = await client.GetAsync("/admin/cikis", TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.OK, renewed.StatusCode);
            cookie = renewed.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("PatikaAdmin=", StringComparison.Ordinal)).Split(';')[0];
            client.DefaultRequestHeaders.Remove("Cookie");
            client.DefaultRequestHeaders.Add("Cookie", cookie);
        }
        clock.Now = issued.AddHours(7).AddMinutes(59);
        using var before = await client.GetAsync("/admin/cikis", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);
        clock.Now = issued.AddHours(8);
        using var after = await client.GetAsync("/admin/cikis", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Redirect, after.StatusCode);
        Assert.Equal("/admin/giris", after.Headers.Location?.AbsolutePath);
        Assert.Contains(after.Headers.GetValues("Set-Cookie"), value => value.StartsWith("PatikaAdmin=;", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RevokedApiAccessClearsTheCookieAndExplainsInTurkish()
    {
        await using var factory = Factory(handler: new RevokedHandler());
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("Cookie", AdminBrowser.Cookie(factory, DateTimeOffset.UtcNow));
        using var response = await client.GetAsync("/admin", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal("/admin/giris?ended=1", response.Headers.Location?.OriginalString);
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), value => value.StartsWith("PatikaAdmin=;", StringComparison.Ordinal));
        client.DefaultRequestHeaders.Remove("Cookie");
        var html = await client.GetStringAsync("/admin/giris?ended=1", TestContext.Current.CancellationToken);
        Assert.Contains("Yönetim yetkin değişti", html, StringComparison.Ordinal);
    }

    private sealed class RevokedHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden)
            {
                Content = new StringContent("{\"code\":\"admin_access_revoked\"}", System.Text.Encoding.UTF8, "application/problem+json")
            });
    }

    [Theory]
    [InlineData("mfa_required", 403)]
    [InlineData("target_mfa_required", 409)]
    [InlineData("step_up_required", 403)]
    [InlineData("transition_invalid", 409)]
    [InlineData("account_suspended", 403)]
    [InlineData("admin_access_revoked", 403)]
    [InlineData("rate_limited", 429)]
    public void ProblemsHaveTurkishMessages(string code, int status)
    {
        var message = new AdminApiException(status, code).Turkish;
        Assert.DoesNotContain(code, message, StringComparison.Ordinal);
        Assert.NotEmpty(message);
    }
}
