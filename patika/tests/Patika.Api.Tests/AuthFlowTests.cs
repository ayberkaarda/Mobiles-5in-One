using System.Net;
using System.Net.Http.Json;
using System.Text;
using Patika.Api.Email;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests;

public sealed class AuthFlowTests : IAsyncLifetime
{
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

    [Fact]
    public async Task RegisterAnswersNewAndExistingAddressesIdentically()
    {
        var email = NewEmail();

        using var first = await client.PostRegisterAsync(email);
        var firstBody = await first.Content.ReadAsStringAsync(Ct);
        var user = Assert.Single(factory.Store.Users);
        using var second = await client.PostRegisterAsync(email.ToUpperInvariant(), "baska-bir-sifre-77", "Başka Biri");
        var secondBody = await second.Content.ReadAsStringAsync(Ct);

        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, second.StatusCode);
        Assert.Equal(firstBody, secondBody);
        Assert.Equal("{\"status\":\"verification_pending\"}", firstBody);
        Assert.Equal(first.Headers.Location, second.Headers.Location);

        // The existing account is untouched and its owner gets a notice instead of a code.
        Assert.Equal(user, Assert.Single(factory.Store.Users));
        Assert.Equal([EmailKind.VerifyEmail, EmailKind.RegistrationAttempt], factory.Outbox.For(email).Select(m => m.Kind));
        Assert.DoesNotContain(factory.Outbox.For(email)[1].Body.Split('\n'), line => EmailCodeHasher.LooksValid(line.Trim()));
    }

    [Fact]
    public async Task VerifiedRegistrationIssuesTokensAndMeReturnsTheProfile()
    {
        var email = NewEmail();
        using var registered = await client.PostRegisterAsync(email);
        var pending = Assert.Single(factory.Store.Users);
        Assert.Null(pending.EmailVerifiedAt);
        Assert.StartsWith("$argon2id$v=19$m=65536,t=3,p=1$", pending.PasswordHash, StringComparison.Ordinal);
        Assert.Empty(factory.Store.Tokens);

        using var verified = await client.VerifyEmailAsync(email, factory.Outbox.VerificationCodeFor(email));
        Assert.Equal(HttpStatusCode.OK, verified.StatusCode);
        var tokens = (await verified.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        Assert.Equal("Bearer", tokens.TokenType);
        Assert.Equal(900, tokens.ExpiresIn);
        Assert.Equal(30 * 24 * 3600, tokens.RefreshExpiresIn);

        using var me = await client.GetMeAsync(tokens.AccessToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var profile = await me.Content.ReadFromJsonAsync<MeResponse>(Ct);
        Assert.Equal(email, profile!.Email);
        Assert.Equal("User", profile.Role);
        Assert.True(profile.EmailVerified);
        var token = Assert.Single(factory.Store.Tokens);
        Assert.Equal(RefreshTokens.Hash(tokens.RefreshToken), token.TokenHash);
    }

    [Fact]
    public async Task VerificationCodesAreSingleUseAndExpire()
    {
        var email = NewEmail();
        using var registered = await client.PostRegisterAsync(email);
        var code = factory.Outbox.VerificationCodeFor(email);

        using var once = await client.VerifyEmailAsync(email, code);
        using var twice = await client.VerifyEmailAsync(email, code);
        using var unknown = await client.VerifyEmailAsync(NewEmail("bilinmeyen"), code);
        Assert.Equal(HttpStatusCode.OK, once.StatusCode);
        Assert.Equal(AuthErrorCodes.VerificationInvalid, (await twice.ReadProblemAsync()).Code);
        Assert.Equal(AuthErrorCodes.VerificationInvalid, (await unknown.ReadProblemAsync()).Code);

        var late = NewEmail();
        using var lateRegistration = await client.PostRegisterAsync(late);
        factory.Store.ExpireEmailTokens();
        using var expired = await client.VerifyEmailAsync(late, factory.Outbox.VerificationCodeFor(late));
        Assert.Equal(HttpStatusCode.BadRequest, expired.StatusCode);
        Assert.Null(factory.Store.Users.Single(u => u.Email == late).EmailVerifiedAt);
    }

    [Fact]
    public async Task UnverifiedAccountLoginLooksExactlyLikeAWrongPassword()
    {
        var email = NewEmail();
        using var registered = await client.PostRegisterAsync(email);

        using var correctPassword = await client.LoginAsync(email);
        using var wrongPassword = await client.LoginAsync(NewEmail(), "yanlis-sifre-123");
        var unverified = await correctPassword.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(Ct);
        var wrong = await wrongPassword.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, correctPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(AuthErrorCodes.InvalidCredentials, unverified.GetProperty("code").GetString());
        Assert.Equal(wrong.GetProperty("title").GetString(), unverified.GetProperty("title").GetString());
        Assert.Equal(wrong.GetProperty("code").GetString(), unverified.GetProperty("code").GetString());
    }

    [Fact]
    public async Task LoginSucceedsWithNormalizedEmailAndFailsGenerically()
    {
        var email = NewEmail();
        await client.RegisterAsync(factory, email);

        using var padded = await client.LoginAsync("  " + email.ToUpperInvariant() + " ");
        Assert.Equal(HttpStatusCode.OK, padded.StatusCode);

        using var wrong = await client.LoginAsync(email, "yanlis-sifre-123");
        using var unknown = await client.LoginAsync(NewEmail(), "yanlis-sifre-123");
        var wrongProblem = await wrong.ReadProblemAsync();
        var unknownProblem = await unknown.ReadProblemAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal(AuthErrorCodes.InvalidCredentials, wrongProblem.Code);
        Assert.Equal(wrongProblem.Title, unknownProblem.Title);
    }

    [Fact]
    public async Task BreachedPasswordIsRejectedAtRegistration()
    {
        factory.Breached.MarkBreached("password1234");

        using var response = await client.PostRegisterAsync(NewEmail(), "password1234");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.ReadJsonAsync();
        Assert.Equal(AuthErrorCodes.PasswordBreached, body.GetProperty("code").GetString());
        Assert.True(body.GetProperty("errors").TryGetProperty("password", out _));
        Assert.Empty(factory.Store.Users);
        Assert.Empty(factory.Outbox.Messages);
    }

    [Fact]
    public async Task ValidationProblemNamesFieldsInCamelCase()
    {
        using var response = await client.PostAsJsonAsync("/v1/auth/register", new RegisterRequest("x", "kisa", ""), Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.ReadJsonAsync();
        Assert.Equal(AuthErrorCodes.ValidationFailed, body.GetProperty("code").GetString());
        var errors = body.GetProperty("errors");
        Assert.True(errors.TryGetProperty("email", out _));
        Assert.True(errors.TryGetProperty("password", out _));
        Assert.True(errors.TryGetProperty("displayName", out _));
    }

    [Theory]
    [InlineData("{\"email\":\"a@b.co\",\"password\":\"0123456789\",\"displayName\":\"Pamuk\",\"role\":\"Admin\"}")]
    [InlineData("{\"email\":\"a@b.co\",\"password\":")]
    [InlineData("[]")]
    public async Task UnknownMembersAndMalformedJsonAreBadRequests(string json)
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await client.PostAsync("/v1/auth/register", content, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await response.ReadProblemAsync();
        Assert.Empty(factory.Store.Users);
    }

    [Fact]
    public async Task GoogleSignInCreatesAndThenReusesTheAccount()
    {
        var email = NewEmail("google");
        var first = factory.Google.Issue("google-sub-1", email, emailVerified: true);

        using var created = await client.PostAsJsonAsync("/v1/auth/google", new GoogleSignInRequest(first), Ct);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var user = Assert.Single(factory.Store.Users);
        Assert.Null(user.PasswordHash);
        Assert.NotNull(user.EmailVerifiedAt);

        var second = factory.Google.Issue("google-sub-1", email, emailVerified: true);
        using var again = await client.PostAsJsonAsync("/v1/auth/google", new GoogleSignInRequest(second), Ct);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Single(factory.Store.Users);

        // External-only accounts have no password login.
        using var password = await client.LoginAsync(email, StrongPassword);
        Assert.Equal(HttpStatusCode.Unauthorized, password.StatusCode);
    }

    [Fact]
    public async Task GoogleSignInRejectsUnverifiedTokens()
    {
        using var response = await client.PostAsJsonAsync("/v1/auth/google", new GoogleSignInRequest("h.forged.s"), Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(AuthErrorCodes.ExternalTokenInvalid, (await response.ReadProblemAsync()).Code);
    }

    [Fact]
    public async Task RefreshRotatesAndLogoutEndsTheFamily()
    {
        var tokens = await client.RegisterAsync(factory, NewEmail());

        using var rotated = await client.RefreshAsync(tokens.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        var next = (await rotated.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        Assert.NotEqual(tokens.RefreshToken, next.RefreshToken);
        var old = factory.Store.Tokens.Single(t => t.TokenHash.SequenceEqual(RefreshTokens.Hash(tokens.RefreshToken)));
        var current = factory.Store.Tokens.Single(t => t.TokenHash.SequenceEqual(RefreshTokens.Hash(next.RefreshToken)));
        Assert.NotNull(old.RevokedAt);
        Assert.Equal(current.Id, old.ReplacedById);
        Assert.Equal(old.FamilyId, current.FamilyId);

        using var logout = await client.PostAsJsonAsync("/v1/auth/logout", new LogoutRequest(next.RefreshToken), Ct);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.All(factory.Store.Tokens, t => Assert.NotNull(t.RevokedAt));

        using var unknownLogout = await client.PostAsJsonAsync("/v1/auth/logout", new LogoutRequest(RefreshTokens.NewToken()), Ct);
        Assert.Equal(HttpStatusCode.NoContent, unknownLogout.StatusCode);
    }

    [Fact]
    public async Task UnknownRefreshTokenIsRejected()
    {
        using var response = await client.RefreshAsync(RefreshTokens.NewToken());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(AuthErrorCodes.RefreshInvalid, (await response.ReadProblemAsync()).Code);
    }

    [Fact]
    public async Task DeactivatedAccountLosesAccessImmediately()
    {
        var email = NewEmail();
        var tokens = await client.RegisterAsync(factory, email);
        var user = Assert.Single(factory.Store.Users);
        factory.Store.Update(user.Id, u => u with { DeactivatedAt = DateTimeOffset.UtcNow });

        using var me = await client.GetMeAsync(tokens.AccessToken);
        using var login = await client.LoginAsync(email);
        using var refresh = await client.RefreshAsync(tokens.RefreshToken);

        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        Assert.All(factory.Store.Tokens, t => Assert.NotNull(t.RevokedAt));
    }

    [Fact]
    public async Task MeLivesAtV1MeAndRequiresAToken()
    {
        using var anonymous = await client.GetMeAsync(null);
        using var oldPath = await client.GetAsync("/v1/auth/me", Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal("http_401", (await anonymous.ReadProblemAsync()).Code);
        Assert.Equal(HttpStatusCode.NotFound, oldPath.StatusCode);
    }
}
