using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.JsonWebTokens;
using Patika.Api.Email;
using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Account;
using Patika.Contracts.Auth;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests.Auth;

/// <summary>Access tokens carry <c>sv</c>; a version change on the account rejects every older token at once.</summary>
public sealed class SessionVersionTests : IAsyncLifetime
{
    private const string NewPassword = "yeni-mama-kabi-55";

    private readonly PatikaApiFactory factory = new();
    private LifecycleAuthStore store = null!;

    public ValueTask InitializeAsync()
    {
        store = new LifecycleAuthStore(factory.Store);
        factory.ExtraServices = services => PasswordResetTests.ReplaceStores(services, store);
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync() => await factory.DisposeAsync();

    [Fact]
    public async Task AStolenAccessTokenStopsWorkingTheMomentThePasswordIsReset()
    {
        using var client = factory.CreateApiClient("203.0.113.40");
        var email = NewEmail();
        var stolen = await client.RegisterAsync(factory, email);
        Assert.Equal("0", SessionClaim(stolen.AccessToken));
        using (var before = await client.GetMeAsync(stolen.AccessToken))
        {
            Assert.Equal(HttpStatusCode.OK, before.StatusCode);
        }

        await ResetPasswordAsync(client, email);

        using var after = await client.GetMeAsync(stolen.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        using var login = await client.LoginAsync(email, NewPassword);
        var fresh = await login.Content.ReadFromJsonAsync<TokenResponse>(Ct);
        Assert.Equal("1", SessionClaim(fresh!.AccessToken));
        using var me = await client.GetMeAsync(fresh.AccessToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task CancellingADeletionDoesNotReviveTokensFromBeforeTheRequest()
    {
        using var client = factory.CreateApiClient("203.0.113.41");
        var email = NewEmail();
        var old = await client.RegisterAsync(factory, email);
        var user = factory.Store.Users.Single();
        Assert.IsType<Accepted<AccountDeletionResponse>>(await DeleteAsync(user));

        using var login = await client.LoginAsync(email);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var fresh = await login.Content.ReadFromJsonAsync<TokenResponse>(Ct);

        Assert.True(factory.Store.Users.Single().IsActive);
        using var stale = await client.GetMeAsync(old.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, stale.StatusCode);
        using var me = await client.GetMeAsync(fresh!.AccessToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Equal("2", SessionClaim(fresh.AccessToken));
    }

    [Fact]
    public async Task RefreshedAccessTokensCarryTheCurrentVersion()
    {
        using var client = factory.CreateApiClient("203.0.113.42");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        await ResetPasswordAsync(client, email);
        using var login = await client.LoginAsync(email, NewPassword);
        var session = await login.Content.ReadFromJsonAsync<TokenResponse>(Ct);

        using var refresh = await client.RefreshAsync(session!.RefreshToken);
        var rotated = await refresh.Content.ReadFromJsonAsync<TokenResponse>(Ct);

        Assert.Equal("1", SessionClaim(rotated!.AccessToken));
        using var me = await client.GetMeAsync(rotated.AccessToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task ALoginThatCheckedAReplacedPasswordGetsNoSession()
    {
        using var client = factory.CreateApiClient("203.0.113.43");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var user = factory.Store.Users.Single();
        var before = factory.Store.Tokens.Count;
        var refresh = new RefreshTokenRecord(Guid.CreateVersion7(), user.Id, Guid.CreateVersion7(),
            RefreshTokens.Hash(RefreshTokens.NewToken()), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddDays(30), null, null);

        // The hash verified at credential check is no longer the stored one.
        factory.Store.Update(user.Id, u => u with { PasswordHash = "$argon2id$replaced" });

        Assert.Null(await ((IAuthStore)store).TryIssueSessionAsync(refresh, user.PasswordHash, Ct));
        Assert.Equal(before, factory.Store.Tokens.Count);
    }

    [Fact]
    public async Task MalformedOrForeignVersionClaimsAreRejected()
    {
        var user = factory.Store.AddUser(NewEmail());
        var cache = new SessionVersionCache(TimeProvider.System);

        Assert.True(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, "0"), store, cache, Ct));
        Assert.True(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, null), store, cache, Ct));
        Assert.False(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, "1"), store, cache, Ct));
        Assert.False(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, "-1"), store, cache, Ct));
        Assert.False(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, "0x0"), store, cache, Ct));
        Assert.False(await SessionVersionCheck.IsCurrentAsync(Principal(Guid.CreateVersion7(), "0"), store, cache, Ct));
    }

    [Fact]
    public async Task TheCacheIsBypassedForANewerTokenAndExpiresWithinThirtySeconds()
    {
        var user = factory.Store.AddUser(NewEmail());
        var clock = new ManualClock();
        var cache = new SessionVersionCache(clock);
        Assert.True(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, "0"), store, cache, Ct));

        // Another instance bumped the version: the newer token is accepted at once (cache refetch).
        factory.Store.Update(user.Id, u => u with { SessionVersion = 1 });
        Assert.True(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, "1"), store, cache, Ct));
        Assert.False(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, "0"), store, cache, Ct));

        factory.Store.Update(user.Id, u => u with { SessionVersion = 2 });
        Assert.True(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, "1"), store, cache, Ct));
        clock.Advance(SessionVersionCache.Lifetime);
        Assert.False(await SessionVersionCheck.IsCurrentAsync(Principal(user.Id, "1"), store, cache, Ct));
        Assert.True(SessionVersionCache.Lifetime <= TimeSpan.FromSeconds(30));
    }

    private async Task ResetPasswordAsync(HttpClient client, string email)
    {
        using var forgot = await client.PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest(email), Ct);
        Assert.Equal(HttpStatusCode.Accepted, forgot.StatusCode);
        var code = PasswordResetTests.CodeFrom(factory.Outbox.For(email).Last(m => m.Kind == EmailKind.PasswordReset));
        using var reset = await client.PostAsJsonAsync("/v1/auth/reset", new ResetPasswordRequest(email, code, NewPassword), Ct);
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);
    }

    private async Task<IResult> DeleteAsync(AuthUser user)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var principal = Principal(user.Id, "0", PatikaClaims.PasswordMethod);
        var http = new DefaultHttpContext { User = principal, RequestServices = services };
        return await AccountEndpoints.DeleteMeAsync(http, services.GetRequiredService<IAuthStore>(),
            services.GetRequiredService<IAccountDeletionStore>(), services.GetRequiredService<IAuthorizationService>(),
            services.GetRequiredService<IEmailSender>(), TimeProvider.System, services.GetRequiredService<ILoggerFactory>(), Ct);
    }

    private static string? SessionClaim(string accessToken) =>
        new JsonWebToken(accessToken).Claims.SingleOrDefault(c => c.Type == PatikaClaims.SessionVersion)?.Value;

    private static ClaimsPrincipal Principal(Guid userId, string? sessionVersion, string? method = null)
    {
        var claims = new List<Claim>
        {
            new(PatikaClaims.Subject, userId.ToString()),
            new(PatikaClaims.Role, "User"),
        };
        if (sessionVersion is not null)
        {
            claims.Add(new Claim(PatikaClaims.SessionVersion, sessionVersion));
        }

        if (method is not null)
        {
            claims.Add(new Claim(PatikaClaims.AuthMethod, method));
            claims.Add(new Claim(PatikaClaims.AuthTime,
                DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer", PatikaClaims.Subject, PatikaClaims.Role));
    }

    private sealed class ManualClock : TimeProvider
    {
        private long ticks;

        public override long TimestampFrequency => TimeSpan.TicksPerSecond;

        public override long GetTimestamp() => ticks;

        public void Advance(TimeSpan by) => ticks += by.Ticks;
    }
}
