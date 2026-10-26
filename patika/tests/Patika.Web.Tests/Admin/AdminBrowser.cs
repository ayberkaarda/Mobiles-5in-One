using System.Net;
using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Patika.Web.Services.Admin;
using Xunit;

namespace Patika.Web.Tests.Admin;

internal static class AdminBrowser
{
    public static string Field(string html, string name)
    {
        var tag = Regex.Match(html, "<input[^>]*name=\"" + Regex.Escape(name) + "\"[^>]*>", RegexOptions.CultureInvariant);
        Assert.True(tag.Success, $"Missing field: {name}");
        return WebUtility.HtmlDecode(Regex.Match(tag.Value, "value=\"([^\"]*)\"", RegexOptions.CultureInvariant).Groups[1].Value);
    }

    public static async Task<HttpResponseMessage> PostAsync(HttpClient client, string path, Dictionary<string, string> values, string? html = null)
    {
        html ??= await client.GetStringAsync(path, TestContext.Current.CancellationToken);
        values["__RequestVerificationToken"] = Field(html, "__RequestVerificationToken");
        return await client.PostAsync(path, new FormUrlEncodedContent(values), TestContext.Current.CancellationToken);
    }

    public static string Cookie(WebApplicationFactory<Program> factory, DateTimeOffset issued, string role = "Admin", bool mfa = true)
    {
        var options = factory.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(AdminSession.Scheme);
        var claims = new List<Claim> { new("sub", Guid.NewGuid().ToString()), new("role", role), new(AdminSession.Issued, issued.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture)) };
        if (mfa) claims.Add(new Claim("amr", "mfa"));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, AdminSession.Scheme, "sub", "role"));
        var properties = new AuthenticationProperties { IssuedUtc = issued, ExpiresUtc = issued.AddMinutes(30), AllowRefresh = true };
        properties.StoreTokens([new AuthenticationToken { Name = "expires_at", Value = issued.AddDays(1).ToString("O") }]);
        return "PatikaAdmin=" + options.TicketDataFormat.Protect(new AuthenticationTicket(principal, properties, AdminSession.Scheme));
    }
}

public sealed class AdminClock : TimeProvider
{
    public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
    public override DateTimeOffset GetUtcNow() => Now;
}
