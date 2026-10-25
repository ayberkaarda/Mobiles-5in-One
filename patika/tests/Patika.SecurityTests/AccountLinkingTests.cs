using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Patika.Domain.Security;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.SecurityTests;

/// <summary>
/// Account takeover through external sign-in: Google never auto-links by email; linking needs the
/// account owner's fresh password session.
/// </summary>
public sealed class AccountLinkingTests : IAsyncLifetime
{
    private const string LinkPath = "/v1/me/external-logins/google";
    private readonly PatikaApiFactory factory = new();
    private HttpClient client = null!;

    public ValueTask InitializeAsync()
    {
        client = factory.CreateApiClient();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        client.Dispose();
        await factory.DisposeAsync();
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task GoogleIdentityMatchingAnExistingEmailGetsLinkRequiredAndNoTokens(bool localVerified, bool googleVerified)
    {
        var email = NewEmail("kurban");
        if (localVerified)
        {
            await client.RegisterAsync(factory, email);
        }
        else
        {
            using var pending = await client.PostRegisterAsync(email);
        }

        var token = factory.Google.Issue("attacker-controlled-sub", email.ToUpperInvariant(), googleVerified);
        var tokensBefore = factory.Store.Tokens.Count;

        using var response = await client.PostAsJsonAsync("/v1/auth/google", new GoogleSignInRequest(token), Ct);
        var raw = await response.Content.ReadAsStringAsync(Ct);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(AuthErrorCodes.LinkRequired, (await response.ReadProblemAsync()).Code);
        Assert.DoesNotContain("accessToken", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("refreshToken", raw, StringComparison.Ordinal);
        Assert.Single(factory.Store.Users);
        Assert.Null(await factory.Store.FindUserByExternalLoginAsync(new("google", "attacker-controlled-sub"), Ct));
        Assert.Equal(tokensBefore, factory.Store.Tokens.Count);
    }

    [Fact]
    public async Task OwnerLinksFromAFreshPasswordSessionAndThenSignsInWithGoogle()
    {
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var password = await PasswordLoginAsync(email);
        var idToken = factory.Google.Issue("owner-sub", email, emailVerified: true);

        using var link = await LinkAsync(password.AccessToken, idToken);
        Assert.Equal(HttpStatusCode.NoContent, link.StatusCode);

        using var again = await LinkAsync(password.AccessToken, factory.Google.Issue("owner-sub", email, true));
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);

        using var google = await client.PostAsJsonAsync("/v1/auth/google",
            new GoogleSignInRequest(factory.Google.Issue("owner-sub", email, emailVerified: true)), Ct);
        Assert.Equal(HttpStatusCode.OK, google.StatusCode);
        var tokens = (await google.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        using var me = await client.GetMeAsync(tokens.AccessToken);
        Assert.Equal(email, (await me.Content.ReadFromJsonAsync<MeResponse>(Ct))!.Email);
        Assert.Single(factory.Store.Users);
    }

    [Fact]
    public async Task TokensNotFromARecentPasswordLoginCannotLink()
    {
        var email = NewEmail();
        var fromVerification = await client.RegisterAsync(factory, email);
        var password = await PasswordLoginAsync(email);
        using var refreshed = await client.RefreshAsync(password.RefreshToken);
        var fromRefresh = (await refreshed.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        var userId = factory.Store.Users.Single().Id;
        var stale = JwtForge.Sign(userId, ActorRole.User, JwtForge.ServerKey(), extraClaims: AuthClaims("pwd", -11));
        var recent = JwtForge.Sign(userId, ActorRole.User, JwtForge.ServerKey(), extraClaims: AuthClaims("pwd", -5));
        var federated = JwtForge.Sign(userId, ActorRole.User, JwtForge.ServerKey(), extraClaims: AuthClaims("fed", -1));

        foreach (var accessToken in new[] { fromVerification.AccessToken, fromRefresh.AccessToken, stale, federated })
        {
            using var denied = await LinkAsync(accessToken, factory.Google.Issue("sub-" + Guid.NewGuid(), email, true));
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
            Assert.Equal(AuthErrorCodes.ReauthenticationRequired, (await denied.ReadProblemAsync()).Code);
        }

        // Control: a server-signed token with a five-minute-old password authentication links.
        using var allowed = await LinkAsync(recent, factory.Google.Issue("sub-recent", email, true));
        Assert.Equal(HttpStatusCode.NoContent, allowed.StatusCode);
    }

    [Fact]
    public async Task AnIdentityLinkedToAnotherAccountCannotBeTaken()
    {
        var victim = NewEmail("b");
        var attacker = NewEmail("a");
        await client.RegisterAsync(factory, victim);
        await client.RegisterAsync(factory, attacker);
        var victimSession = await PasswordLoginAsync(victim);
        var attackerSession = await PasswordLoginAsync(attacker);
        using var victimLink = await LinkAsync(victimSession.AccessToken, factory.Google.Issue("victim-sub", victim, true));
        Assert.Equal(HttpStatusCode.NoContent, victimLink.StatusCode);

        using var steal = await LinkAsync(attackerSession.AccessToken, factory.Google.Issue("victim-sub", victim, true));

        Assert.Equal(HttpStatusCode.Conflict, steal.StatusCode);
        Assert.Equal(AuthErrorCodes.ExternalLoginInUse, (await steal.ReadProblemAsync()).Code);
        var owner = await factory.Store.FindUserByExternalLoginAsync(new("google", "victim-sub"), Ct);
        Assert.Equal(victim, owner!.Email);
    }

    [Fact]
    public async Task LinkingRequiresAuthenticationAndAValidIdToken()
    {
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var session = await PasswordLoginAsync(email);

        using var anonymous = await LinkAsync(null, factory.Google.Issue("anon-sub", email, true));
        using var forged = await LinkAsync(session.AccessToken, "h.not-issued.s");

        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, forged.StatusCode);
        Assert.Equal(AuthErrorCodes.ExternalTokenInvalid, (await forged.ReadProblemAsync()).Code);
    }

    private static Claim[] AuthClaims(string method, int minutesAgo) =>
    [
        new(PatikaClaims.AuthMethod, method),
        new(PatikaClaims.AuthTime,
            DateTimeOffset.UtcNow.AddMinutes(minutesAgo).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
            ClaimValueTypes.Integer64),
    ];

    private async Task<TokenResponse> PasswordLoginAsync(string email)
    {
        using var login = await client.LoginAsync(email);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (await login.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
    }

    private async Task<HttpResponseMessage> LinkAsync(string? accessToken, string idToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, LinkPath)
        {
            Content = JsonContent.Create(new LinkExternalLoginRequest(idToken)),
        };
        if (accessToken is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        }

        return await client.SendAsync(request, Ct);
    }
}
