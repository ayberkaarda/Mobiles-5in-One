using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Patika.Api.Email;
using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Auth;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Account;
using Patika.Contracts.Auth;
using Patika.Domain.Security;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests.Account;

/// <summary>
/// <c>DELETE /v1/me</c> is exercised through its handler (the route is mapped by <c>MapAccount</c> in the
/// host); everything after it, sign-in, refresh and <c>/v1/me</c>, goes through the real HTTP pipeline.
/// </summary>
public sealed class AccountDeletionTests : IAsyncLifetime
{
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
    public async Task DeletionNeedsAFreshInteractiveSignIn()
    {
        using var client = factory.CreateApiClient("192.0.2.1");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var user = factory.Store.Users.Single();

        var refreshed = await DeleteAsync(Principal(user, method: null, age: TimeSpan.Zero));
        var stale = await DeleteAsync(Principal(user, PatikaClaims.PasswordMethod, TimeSpan.FromMinutes(11)));
        var emailLink = await DeleteAsync(Principal(user, PatikaClaims.EmailLinkMethod, TimeSpan.Zero));

        foreach (var result in new[] { refreshed, stale, emailLink })
        {
            var problem = Assert.IsType<ProblemHttpResult>(result);
            Assert.Equal(StatusCodes.Status403Forbidden, problem.StatusCode);
            Assert.Equal(AuthErrorCodes.ReauthenticationRequired, problem.ProblemDetails.Extensions["code"]);
        }

        Assert.True(factory.Store.Users.Single().IsActive);
        Assert.Null(store.DeletionFor(user.Id));
        Assert.DoesNotContain(factory.Outbox.Messages, m => m.Kind == EmailKind.DeletionScheduled);
    }

    [Fact]
    public async Task DeletionDeactivatesAtOnceRevokesSessionsAndSendsConfirmation()
    {
        using var client = factory.CreateApiClient("192.0.2.2");
        var email = NewEmail();
        var signUp = await client.RegisterAsync(factory, email);
        var user = factory.Store.Users.Single();
        var before = DateTimeOffset.UtcNow;

        var result = await DeleteAsync(Principal(user, PatikaClaims.PasswordMethod, TimeSpan.FromMinutes(1)));

        var accepted = Assert.IsType<Accepted<AccountDeletionResponse>>(result);
        Assert.Equal(AccountDeletionResponse.Scheduled, accepted.Value!.Status);
        Assert.InRange(accepted.Value.ExecuteAfter, before + TimeSpan.FromDays(7), DateTimeOffset.UtcNow + TimeSpan.FromDays(7));
        Assert.False(factory.Store.Users.Single().IsActive);

        using var me = await client.GetMeAsync(signUp.AccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
        using var refresh = await client.RefreshAsync(signUp.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        Assert.All(factory.Store.Tokens, t => Assert.NotNull(t.RevokedAt));

        var confirmation = Assert.Single(factory.Outbox.For(email), m => m.Kind == EmailKind.DeletionScheduled);
        Assert.Contains(AccountEmails.FormatDate(accepted.Value.ExecuteAfter), confirmation.Body, StringComparison.Ordinal);
        Assert.DoesNotContain(email, string.Join('\n', factory.Logs.RenderAll()), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PasswordSignInDuringTheGracePeriodCancelsDeletion()
    {
        using var client = factory.CreateApiClient("192.0.2.3");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var user = factory.Store.Users.Single();
        Assert.IsType<Accepted<AccountDeletionResponse>>(
            await DeleteAsync(Principal(user, PatikaClaims.PasswordMethod, TimeSpan.Zero)));

        using var login = await client.LoginAsync(email);

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.True(factory.Store.Users.Single().IsActive);
        Assert.NotNull(store.DeletionFor(user.Id)!.CancelledAt);
        var tokens = await login.Content.ReadFromJsonAsync<TokenResponse>(Ct);
        using var me = await client.GetMeAsync(tokens!.AccessToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task WrongPasswordDuringTheGracePeriodDoesNotCancel()
    {
        using var client = factory.CreateApiClient("192.0.2.4");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var user = factory.Store.Users.Single();
        await DeleteAsync(Principal(user, PatikaClaims.PasswordMethod, TimeSpan.Zero));

        using var login = await client.LoginAsync(email, "yanlis-sifre-123");

        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        Assert.False(factory.Store.Users.Single().IsActive);
        Assert.Null(store.DeletionFor(user.Id)!.CancelledAt);
    }

    [Fact]
    public async Task SignInAfterTheGracePeriodDoesNotCancel()
    {
        using var client = factory.CreateApiClient("192.0.2.5");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var user = factory.Store.Users.Single();
        await DeleteAsync(Principal(user, PatikaClaims.PasswordMethod, TimeSpan.Zero));
        store.EndGracePeriod(user.Id);

        using var login = await client.LoginAsync(email);

        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        Assert.False(factory.Store.Users.Single().IsActive);
        Assert.Null(store.DeletionFor(user.Id)!.CancelledAt);
    }

    [Fact]
    public async Task GoogleSignInDuringTheGracePeriodCancelsDeletion()
    {
        using var client = factory.CreateApiClient("192.0.2.6");
        var subject = $"sub-{Guid.NewGuid():N}";
        using var first = await client.PostAsJsonAsync("/v1/auth/google",
            new GoogleSignInRequest(factory.Google.Issue(subject, NewEmail("google"), emailVerified: true)), Ct);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var user = factory.Store.Users.Single();
        Assert.IsType<Accepted<AccountDeletionResponse>>(
            await DeleteAsync(Principal(user, PatikaClaims.ExternalMethod, TimeSpan.Zero)));
        Assert.False(factory.Store.Users.Single().IsActive);

        using var again = await client.PostAsJsonAsync("/v1/auth/google",
            new GoogleSignInRequest(factory.Google.Issue(subject, user.Email, emailVerified: true)), Ct);

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.True(factory.Store.Users.Single().IsActive);
    }

    [Fact]
    public async Task ModerationDeactivationIsNotUndoneBySignIn()
    {
        using var client = factory.CreateApiClient("192.0.2.7");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var user = factory.Store.Users.Single();
        factory.Store.Update(user.Id, u => u with { DeactivatedAt = DateTimeOffset.UtcNow });

        using var login = await client.LoginAsync(email);

        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        Assert.False(factory.Store.Users.Single().IsActive);
    }

    [Fact]
    public async Task AnotherUsersTokenCannotDeleteAnAccountItDoesNotOwn()
    {
        using var client = factory.CreateApiClient("192.0.2.8");
        await client.RegisterAsync(factory, NewEmail("bir"));
        var ghost = new AuthUser(Guid.CreateVersion7(), null, null, "Yok", ActorRole.User, null, null);

        var result = await DeleteAsync(Principal(ghost, PatikaClaims.PasswordMethod, TimeSpan.Zero));

        Assert.IsType<UnauthorizedHttpResult>(result);
        Assert.All(factory.Store.Users, u => Assert.True(u.IsActive));
    }

    private async Task<IResult> DeleteAsync(ClaimsPrincipal principal)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var http = new DefaultHttpContext { User = principal, RequestServices = services };
        return await AccountEndpoints.DeleteMeAsync(http, services.GetRequiredService<IAuthStore>(),
            services.GetRequiredService<IAccountDeletionStore>(), services.GetRequiredService<IAuthorizationService>(),
            services.GetRequiredService<IEmailSender>(), TimeProvider.System, services.GetRequiredService<ILoggerFactory>(), Ct);
    }

    private static ClaimsPrincipal Principal(AuthUser user, string? method, TimeSpan age)
    {
        var claims = new List<Claim>
        {
            new(PatikaClaims.Subject, user.Id.ToString()),
            new(PatikaClaims.Role, user.Role.ToString()),
        };
        if (method is not null)
        {
            claims.Add(new Claim(PatikaClaims.AuthMethod, method));
            claims.Add(new Claim(PatikaClaims.AuthTime,
                (DateTimeOffset.UtcNow - age).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer", PatikaClaims.Subject, PatikaClaims.Role));
    }
}
