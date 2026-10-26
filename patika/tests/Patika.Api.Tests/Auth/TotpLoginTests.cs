using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Passwords;
using Patika.Api.Tests.Admin;
using Patika.Api.Tests.Urgent;
using Patika.Contracts.Auth;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Api.Tests.Auth;

public sealed class TotpLoginTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData(UserRole.User, false)]
    [InlineData(UserRole.Moderator, true)]
    public async Task GoogleUsesTheSameMfaGate(UserRole role, bool expectedMfa)
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var user = rig.User(role);
        var subject = Guid.NewGuid().ToString("N");
        db.Users.Add(user);
        db.ExternalLogins.Add(new ExternalLogin { Provider = "google", Subject = subject, UserId = user.Id });
        await db.SaveChangesAsync(Ct);
        var identity = rig.Factory.Google.Issue(subject, user.Email, true);
        using var response = await rig.SendAsync("/v1/auth/google", new GoogleSignInRequest(identity));
        Assert.Equal(expectedMfa ? HttpStatusCode.Accepted : HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task SuspensionRefusesPasswordGoogleAndRefresh()
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var user = rig.User(UserRole.User);
        user.PasswordHash = await rig.Factory.Services.GetRequiredService<IPasswordHasher>().HashAsync("secure-password-42", Ct);
        db.Users.Add(user);
        await db.SaveChangesAsync(Ct);
        using var login = await rig.SendAsync("/v1/auth/login", new LoginRequest(user.Email!, "secure-password-42"));
        var tokens = (await login.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        user.SuspendedUntil = rig.Clock.Now.AddDays(1);
        var subject = Guid.NewGuid().ToString("N");
        db.ExternalLogins.Add(new ExternalLogin { Provider = "google", Subject = subject, UserId = user.Id });
        await db.SaveChangesAsync(Ct);
        var google = rig.Factory.Google.Issue(subject, user.Email, true);
        foreach (var (path, request) in new (string, object)[]
        {
            ("login", new LoginRequest(user.Email!, "secure-password-42")),
            ("google", new GoogleSignInRequest(google)),
            ("refresh", new RefreshRequest(tokens.RefreshToken)),
        })
        {
            using var response = await rig.SendAsync("/v1/auth/" + path, request);
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            Assert.Contains("account_suspended", await response.Content.ReadAsStringAsync(Ct));
        }
    }

    [Theory]
    [InlineData(UserRole.User, true, false)]
    [InlineData(UserRole.Moderator, false, false)]
    [InlineData(UserRole.Moderator, true, true)]
    [InlineData(UserRole.Admin, true, true)]
    public async Task LoginRequiresMfaOnlyForElevatedEnrolledUsersAndRefreshPreservesIt(UserRole role, bool enrolled, bool expectedMfa)
    {
        await using var rig = new AdminTestRig(database);
        await using var db = database.CreateContext();
        var user = rig.User(role, enrolled);
        user.PasswordHash = await rig.Factory.Services.GetRequiredService<IPasswordHasher>().HashAsync("secure-password-42", Ct);
        db.Users.Add(user);
        await db.SaveChangesAsync(Ct);
        using var login = await rig.SendAsync("/v1/auth/login", new LoginRequest(user.Email!, "secure-password-42"));
        Assert.Equal(expectedMfa ? HttpStatusCode.Accepted : HttpStatusCode.OK, login.StatusCode);
        TokenResponse tokens;
        if (expectedMfa)
        {
            var challenge = (await login.Content.ReadFromJsonAsync<MfaRequiredResponse>(Ct))!;
            Assert.True(challenge.MfaRequired);
            using var completed = await rig.SendAsync("/v1/auth/mfa", new MfaRequest(challenge.MfaToken, rig.Code));
            Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
            tokens = (await completed.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        }
        else tokens = (await login.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        var jwt = new JsonWebToken(tokens.AccessToken);
        Assert.Equal(expectedMfa, jwt.Claims.Any(c => c.Type == "amr" && c.Value == "mfa"));
        using var queue = await rig.SendAsync("/v1/admin/queue?type=invalid", bearer: tokens.AccessToken);
        Assert.Equal(expectedMfa ? HttpStatusCode.BadRequest : HttpStatusCode.Forbidden, queue.StatusCode);
        if (role == UserRole.Moderator && !enrolled) Assert.Contains("mfa_required", await queue.Content.ReadAsStringAsync(Ct));
        using var refresh = await rig.SendAsync("/v1/auth/refresh", new RefreshRequest(tokens.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);
        var refreshed = new JsonWebToken((await refresh.Content.ReadFromJsonAsync<TokenResponse>(Ct))!.AccessToken);
        Assert.Equal(expectedMfa, refreshed.Claims.Any(c => c.Type == "amr" && c.Value == "mfa"));
        if (expectedMfa) Assert.Equal(jwt.GetClaim("auth_time").Value, refreshed.GetClaim("auth_time").Value);
        // An MFA sign-in keeps its first factor, so recent-password actions still work; a refresh never does.
        Assert.True(AuthHandlers.IsRecentPasswordAuthentication(Principal(jwt), rig.Clock.Now));
        Assert.False(AuthHandlers.IsRecentPasswordAuthentication(Principal(refreshed), rig.Clock.Now));
    }

    private static System.Security.Claims.ClaimsPrincipal Principal(JsonWebToken token) =>
        new(new System.Security.Claims.ClaimsIdentity(token.Claims, "Bearer"));
}
