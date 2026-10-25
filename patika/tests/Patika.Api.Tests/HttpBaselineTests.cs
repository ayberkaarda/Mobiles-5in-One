using System.Net;
using System.Net.Http.Json;
using System.Text;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests;

public sealed class HttpBaselineTests
{
    private const string SecretDetail = "Npgsql: duplicate key (email)=(pamuk.gizli@kedimahallesi.example) for user patika";
    private const string InnerDetail = "inner leak: veteriner.gizli@klinik.example near 40.987654, 29.031234";

    [Fact]
    public async Task ForcedServerErrorReturnsOnlyGenericTitleCodeAndTraceId()
    {
        await using var factory = new PatikaApiFactory();
        factory.Store.FailWith = new InvalidOperationException(SecretDetail, new FormatException(InnerDetail));
        using var client = factory.CreateApiClient();

        using var response = await client.LoginAsync(NewEmail());
        var raw = await response.Content.ReadAsStringAsync(Ct);
        var body = await response.ReadJsonAsync();

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(["code", "status", "title", "traceId"], body.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.Equal(PatikaApiServices.GenericErrorTitle, body.GetProperty("title").GetString());
        Assert.Equal("http_500", body.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("traceId").GetString()));
        Assert.DoesNotContain("Npgsql", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("InvalidOperationException", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("   at ", raw, StringComparison.Ordinal);

        // The exception is logged for operators, but its text is scrubbed before any sink sees it.
        var logged = factory.Logs.Events.Where(e => e.Exception is not null).ToArray();
        Assert.NotEmpty(logged);
        var sample = string.Join('\n', factory.Logs.RenderAll());
        Assert.Contains("System.InvalidOperationException", sample, StringComparison.Ordinal);
        Assert.Contains("System.FormatException", sample, StringComparison.Ordinal);
        Assert.Contains("p***@k***", sample, StringComparison.Ordinal);
        foreach (var secret in new[] { "pamuk.gizli", "kedimahallesi", "veteriner.gizli", "klinik.example", "40.987654", "29.031234" })
        {
            Assert.DoesNotContain(secret, sample, StringComparison.OrdinalIgnoreCase);
        }

        Assert.All(logged, e => Assert.DoesNotContain("gizli", e.Exception!.ToString(), StringComparison.Ordinal));
    }

    public static TheoryData<string, string> SecurityHeaderCases => new()
    {
        { "GET", "/health" },
        { "GET", "/v1/unknown" },
        { "GET", "/v1/me" },
        { "POST", "/v1/auth/login" },
    };

    [Theory]
    [MemberData(nameof(SecurityHeaderCases))]
    public async Task EveryResponseCarriesApiSecurityHeaders(string method, string path)
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method == "POST")
        {
            request.Content = JsonContent.Create(new LoginRequest(NewEmail(), "yanlis-sifre-123"));
        }

        using var response = await client.SendAsync(request, Ct);

        response.AssertSecurityHeaders();
    }

    [Fact]
    public async Task ServerErrorAlsoCarriesSecurityHeaders()
    {
        await using var factory = new PatikaApiFactory();
        factory.Store.FailWith = new InvalidOperationException(SecretDetail);
        using var client = factory.CreateApiClient();

        using var response = await client.LoginAsync(NewEmail());

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        response.AssertSecurityHeaders();
    }

    [Fact]
    public async Task CorsIsOffByDefault()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();

        foreach (var origin in new[] { "https://evil.example", "https://patika.app" })
        {
            using var preflight = Preflight(origin);
            using var response = await client.SendAsync(preflight, Ct);
            Assert.DoesNotContain(response.Headers, h => h.Key.StartsWith("Access-Control-", StringComparison.OrdinalIgnoreCase));
        }
    }

    [Fact]
    public async Task CorsFlagAllowsOnlyTheConfiguredOrigin()
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Cors:Enabled"] = "true";
        using var client = factory.CreateApiClient();

        using var allowedRequest = Preflight("https://patika.app");
        using var allowed = await client.SendAsync(allowedRequest, Ct);
        using var deniedRequest = Preflight("https://evil.example");
        using var denied = await client.SendAsync(deniedRequest, Ct);

        Assert.Equal("https://patika.app", allowed.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.DoesNotContain(denied.Headers, h => h.Key.StartsWith("Access-Control-", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task OversizedBodyIsRejectedWith413()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();
        var huge = "{\"email\":\"" + new string('a', 1024 * 1024) + "@example.org\",\"password\":\"x\"}";

        using var declared = new StringContent(huge, Encoding.UTF8, "application/json");
        using var declaredResponse = await client.PostAsync("/v1/auth/login", declared, Ct);
        using var chunked = new ChunkedContent(huge);
        using var chunkedResponse = await client.PostAsync("/v1/auth/login", chunked, Ct);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, declaredResponse.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, chunkedResponse.StatusCode);
        Assert.Equal("http_413", (await declaredResponse.ReadProblemAsync()).Code);
    }

    private static HttpRequestMessage Preflight(string origin)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, "/v1/auth/login");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");
        return request;
    }

    /// <summary>Content without a declared length, so the server must count bytes as they arrive.</summary>
    private sealed class ChunkedContent : HttpContent
    {
        private readonly string text;

        public ChunkedContent(string text)
        {
            this.text = text;
            Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
        }

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            stream.WriteAsync(Encoding.UTF8.GetBytes(text)).AsTask();

        protected override bool TryComputeLength(out long length)
        {
            length = -1;
            return false;
        }
    }
}
