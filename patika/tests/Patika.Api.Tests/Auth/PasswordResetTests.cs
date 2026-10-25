using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Api.Email;
using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests.Auth;

public sealed class PasswordResetTests : IAsyncLifetime
{
    private const string NewPassword = "yeni-mama-kabi-55";

    private readonly PatikaApiFactory factory = new();
    private LifecycleAuthStore store = null!;

    public ValueTask InitializeAsync()
    {
        store = new LifecycleAuthStore(factory.Store);
        factory.ExtraServices = services => ReplaceStores(services, store);
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync() => await factory.DisposeAsync();

    internal static void ReplaceStores(IServiceCollection services, LifecycleAuthStore store)
    {
        services.RemoveAll<IAuthStore>();
        services.AddSingleton<IAuthStore>(store);
        services.RemoveAll<IAccountDeletionStore>();
        services.AddSingleton<IAccountDeletionStore>(store);
        services.AddPatikaSessionVersionCheck();
    }

    [Fact]
    public async Task ForgotAnswersKnownAndUnknownAddressesIdentically()
    {
        using var setup = factory.CreateApiClient("198.51.100.1");
        var known = NewEmail("bilinen");
        await setup.RegisterAsync(factory, known);
        var unknown = NewEmail("bilinmeyen");

        using var client = factory.CreateApiClient("198.51.100.2");
        var (knownResponse, knownElapsed) = await TimedForgotAsync(client, known);
        var (unknownResponse, unknownElapsed) = await TimedForgotAsync(client, unknown);

        Assert.Equal(HttpStatusCode.Accepted, knownResponse.StatusCode);
        Assert.Equal(knownResponse.StatusCode, unknownResponse.StatusCode);
        var knownBody = await knownResponse.Content.ReadAsStringAsync(Ct);
        Assert.Equal("{\"status\":\"reset_email_requested\"}", knownBody);
        Assert.Equal(knownBody, await unknownResponse.Content.ReadAsStringAsync(Ct));
        Assert.Equal(HeaderNames(knownResponse), HeaderNames(unknownResponse));
        Assert.Equal(knownResponse.Content.Headers.ContentType, unknownResponse.Content.Headers.ContentType);
        Assert.Null(knownResponse.Headers.Location);
        Assert.Null(unknownResponse.Headers.Location);

        // Both paths are padded to the same floor, so neither is measurably faster.
        Assert.True(knownElapsed >= AuthHandlers.ForgotResponseTime, $"known took {knownElapsed}");
        Assert.True(unknownElapsed >= AuthHandlers.ForgotResponseTime, $"unknown took {unknownElapsed}");
        Assert.True((knownElapsed - unknownElapsed).Duration() < TimeSpan.FromMilliseconds(250),
            $"known {knownElapsed} vs unknown {unknownElapsed}");

        Assert.Single(factory.Outbox.For(known), m => m.Kind == EmailKind.PasswordReset);
        Assert.Empty(factory.Outbox.For(unknown));
        knownResponse.Dispose();
        unknownResponse.Dispose();
    }

    [Fact]
    public async Task ResetCodeIsSingleUseAndReplacesThePassword()
    {
        using var client = factory.CreateApiClient("198.51.100.3");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var code = await RequestCodeAsync(client, email);

        using var reset = await ResetAsync(client, code, NewPassword);
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        using var replay = await ResetAsync(client, code, "ucuncu-bir-sifre-99");
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
        Assert.Equal(PasswordResetErrorCodes.ResetInvalid, (await replay.ReadProblemAsync()).Code);

        using var oldLogin = await client.LoginAsync(email);
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);
        using var newLogin = await client.LoginAsync(email, NewPassword);
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);
    }

    [Fact]
    public async Task ExpiredResetCodeIsRejected()
    {
        using var client = factory.CreateApiClient("198.51.100.4");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var code = await RequestCodeAsync(client, email);
        store.ExpireResetTokens();

        using var reset = await ResetAsync(client, code, NewPassword);

        Assert.Equal(HttpStatusCode.BadRequest, reset.StatusCode);
        Assert.Equal(PasswordResetErrorCodes.ResetInvalid, (await reset.ReadProblemAsync()).Code);
        using var oldLogin = await client.LoginAsync(email);
        Assert.Equal(HttpStatusCode.OK, oldLogin.StatusCode);
    }

    [Fact]
    public void ResetCodesLiveOneHour() => Assert.Equal(TimeSpan.FromHours(1), AuthHandlers.PasswordResetLifetime);

    [Fact]
    public async Task ANewerCodeVoidsTheOlderOne()
    {
        using var client = factory.CreateApiClient("198.51.100.5");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var first = await RequestCodeAsync(client, email);
        var second = await RequestCodeAsync(client, email);

        using var stale = await ResetAsync(client, first, NewPassword);
        Assert.Equal(HttpStatusCode.BadRequest, stale.StatusCode);
        using var fresh = await ResetAsync(client, second, NewPassword);
        Assert.Equal(HttpStatusCode.NoContent, fresh.StatusCode);
    }

    [Fact]
    public async Task ResetRevokesEveryRefreshFamily()
    {
        using var client = factory.CreateApiClient("198.51.100.6");
        var email = NewEmail();
        var signUp = await client.RegisterAsync(factory, email);
        var phone = await LoginTokensAsync(client, email);
        var tablet = await LoginTokensAsync(client, email);
        var code = await RequestCodeAsync(client, email);

        using var reset = await ResetAsync(client, code, NewPassword);
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        foreach (var session in new[] { signUp, phone, tablet })
        {
            using var refresh = await client.RefreshAsync(session.RefreshToken);
            Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        }

        var userId = Assert.Single(factory.Store.Users).Id;
        var tokens = factory.Store.Tokens.Where(t => t.UserId == userId).ToArray();
        Assert.Equal(3, tokens.Select(t => t.FamilyId).Distinct().Count());
        Assert.All(tokens, t => Assert.NotNull(t.RevokedAt));
    }

    [Fact]
    public async Task BreachedNewPasswordIsRejectedAndTheCodeStaysUsable()
    {
        using var client = factory.CreateApiClient("198.51.100.7");
        var email = NewEmail();
        await client.RegisterAsync(factory, email);
        var code = await RequestCodeAsync(client, email);
        factory.Breached.MarkBreached("sizdirilmis-sifre-1");

        using var breached = await ResetAsync(client, code, "sizdirilmis-sifre-1");
        Assert.Equal(HttpStatusCode.BadRequest, breached.StatusCode);
        Assert.Equal(AuthErrorCodes.PasswordBreached, (await breached.ReadProblemAsync()).Code);

        using var reset = await ResetAsync(client, code, NewPassword);
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);
    }

    [Fact]
    public async Task ExternalOnlyAndInactiveAccountsGetNoResetEmail()
    {
        using var client = factory.CreateApiClient("198.51.100.8");
        var inactive = NewEmail("pasif");
        await client.RegisterAsync(factory, inactive);
        var user = factory.Store.Users.Single(u => u.Email == inactive);
        factory.Store.Update(user.Id, u => u with { DeactivatedAt = DateTimeOffset.UtcNow });
        var googleOnly = NewEmail("google");
        factory.Store.AddUser(googleOnly);

        using var first = await client.PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest(inactive), Ct);
        using var second = await client.PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest(googleOnly), Ct);

        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, second.StatusCode);
        Assert.DoesNotContain(factory.Outbox.Messages, m => m.Kind == EmailKind.PasswordReset);
        Assert.Equal(0, store.ResetTokenCount);
    }

    [Fact]
    public async Task MalformedResetRequestsAreValidationErrors()
    {
        using var client = factory.CreateApiClient("198.51.100.9");

        using var badToken = await ResetAsync(client, "kisa", NewPassword);
        using var shortPassword = await ResetAsync(client, RefreshTokens.NewToken(), "kisa");
        using var badEmail = await client.PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest("adres-degil"), Ct);

        Assert.Equal(HttpStatusCode.BadRequest, badToken.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, shortPassword.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, badEmail.StatusCode);
        Assert.Equal(AuthErrorCodes.ValidationFailed, (await badToken.ReadProblemAsync()).Code);
    }

    [Fact]
    public async Task ResetCodesAndAddressesStayOutOfTheLogs()
    {
        using var client = factory.CreateApiClient("198.51.100.10");
        var email = NewEmail("gizli");
        await client.RegisterAsync(factory, email);
        var code = await RequestCodeAsync(client, email);
        using var reset = await ResetAsync(client, code, NewPassword);
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        var logs = string.Join('\n', factory.Logs.RenderAll());
        Assert.DoesNotContain(email, logs, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(code, logs, StringComparison.Ordinal);
        Assert.DoesNotContain(NewPassword, logs, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ForgotIsRateLimitedPerAddress()
    {
        var email = NewEmail("sinir");
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 6; i++)
        {
            // A fresh peer each time: only the per-address limiter can trip.
            using var client = factory.CreateApiClient($"198.51.100.{20 + i}");
            using var response = await client.PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest(email), Ct);
            statuses.Add(response.StatusCode);
        }

        Assert.Equal(Enumerable.Repeat(HttpStatusCode.Accepted, 5), statuses.Take(5));
        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[5]);
    }

    internal static string CodeFrom(EmailMessage message) =>
        message.Body.Split('\n').Select(line => line.Trim()).Single(RefreshTokens.LooksValid);

    private async Task<string> RequestCodeAsync(HttpClient client, string email)
    {
        using var response = await client.PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest(email), Ct);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        return CodeFrom(factory.Outbox.For(email).Last(m => m.Kind == EmailKind.PasswordReset));
    }

    private static Task<HttpResponseMessage> ResetAsync(HttpClient client, string code, string password) =>
        client.PostAsJsonAsync("/v1/auth/reset", new ResetPasswordRequest(code, password), Ct);

    private static async Task<TokenResponse> LoginTokensAsync(HttpClient client, string email)
    {
        using var response = await client.LoginAsync(email);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
    }

    private static async Task<(HttpResponseMessage Response, TimeSpan Elapsed)> TimedForgotAsync(HttpClient client, string email)
    {
        var watch = Stopwatch.StartNew();
        var response = await client.PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest(email), Ct);
        await response.Content.LoadIntoBufferAsync(Ct);
        return (response, watch.Elapsed);
    }

    private static string[] HeaderNames(HttpResponseMessage response) =>
        [.. response.Headers.Select(h => h.Key).Concat(response.Content.Headers.Select(h => h.Key)).Order(StringComparer.Ordinal)];
}
