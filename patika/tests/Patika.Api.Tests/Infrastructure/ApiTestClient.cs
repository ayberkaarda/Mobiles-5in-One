using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Patika.Contracts.Auth;
using Patika.Contracts.Errors;
using Xunit;

namespace Patika.Api.Tests.Infrastructure;

public static class ApiTestClient
{
    public const string StrongPassword = "mama-kabı-dolu-42";

    public static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static string NewEmail(string prefix = "gonullu") => $"{prefix}.{Guid.NewGuid():N}@example.org";

    /// <summary>Registers, reads the verification code from the outbox and verifies: the full sign-up path.</summary>
    public static async Task<TokenResponse> RegisterAsync(
        this HttpClient client, PatikaApiFactory factory, string email, string password = StrongPassword,
        string displayName = "Mahalle Gönüllüsü")
    {
        using var response = await client.PostRegisterAsync(email, password, displayName);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        using var verified = await client.VerifyEmailAsync(email, factory.Outbox.VerificationCodeFor(email));
        Assert.Equal(HttpStatusCode.OK, verified.StatusCode);
        return (await verified.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
    }

    public static Task<HttpResponseMessage> PostRegisterAsync(
        this HttpClient client, string email, string password = StrongPassword, string displayName = "Mahalle Gönüllüsü") =>
        client.PostAsJsonAsync("/v1/auth/register", new RegisterRequest(email, password, displayName), Ct);

    public static Task<HttpResponseMessage> VerifyEmailAsync(this HttpClient client, string email, string code) =>
        client.PostAsJsonAsync("/v1/auth/verify-email", new VerifyEmailRequest(email, code), Ct);

    public static Task<HttpResponseMessage> ResendVerificationAsync(this HttpClient client, string email) =>
        client.PostAsJsonAsync("/v1/auth/verify-email/resend", new ResendVerificationRequest(email), Ct);

    public static Task<HttpResponseMessage> LoginAsync(this HttpClient client, string email, string password = StrongPassword) =>
        client.PostAsJsonAsync("/v1/auth/login", new LoginRequest(email, password), Ct);

    public static Task<HttpResponseMessage> RefreshAsync(this HttpClient client, string refreshToken) =>
        client.PostAsJsonAsync("/v1/auth/refresh", new RefreshRequest(refreshToken), Ct);

    public static async Task<HttpResponseMessage> GetMeAsync(this HttpClient client, string? accessToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/v1/me");
        if (accessToken is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        }

        return await client.SendAsync(request, Ct);
    }

    public static async Task<ApiProblemDetails> ReadProblemAsync(this HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<ApiProblemDetails>(Ct);
        Assert.NotNull(problem);
        Assert.False(string.IsNullOrWhiteSpace(problem.TraceId));
        return problem;
    }

    public static void AssertSecurityHeaders(this HttpResponseMessage response)
    {
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
        Assert.Equal("default-src 'none'; frame-ancestors 'none'", response.Headers.GetValues("Content-Security-Policy").Single());
        Assert.False(response.Headers.Contains("Server"));
        Assert.False(response.Headers.Contains("X-Powered-By"));
    }

    public static async Task<JsonElement> ReadJsonAsync(this HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
}
