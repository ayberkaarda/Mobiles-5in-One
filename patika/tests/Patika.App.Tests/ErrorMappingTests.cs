using System.Net;
using System.Text;
using System.Text.Json;
using Patika.App.Core.Api;
using Xunit;

namespace Patika.App.Tests;

public sealed class ErrorMappingTests
{
    private static PatikaApiClient Client(Func<RecordedRequest, Task<HttpResponseMessage>> respond, out FakeHandler handler)
    {
        handler = new FakeHandler(respond);
        return new PatikaApiClient(new HttpClient(handler), new TokenManager(new MemoryTokenStore(), new ManualClock()),
            new ApiOptions { BaseAddress = new Uri("http://api.test/") });
    }

    [Theory]
    [InlineData("invalid_credentials", 401, "E-posta ya da şifre hatalı.")]
    [InlineData("password_breached", 400, "Bu şifre sızdırılmış şifre listelerinde var. Başka bir şifre seç.")]
    [InlineData("verification_invalid", 400, "Kod hatalı ya da süresi dolmuş. Yeni kod iste.")]
    [InlineData("feeding_cooldown", 409, "Bu istasyonu yakın zamanda besledin. 30 dakika sonra yeniden kaydedebilirsin.")]
    [InlineData("rate_limited", 429, "Çok fazla deneme yapıldı. Biraz bekleyip yeniden dene.")]
    [InlineData("urgent_daily_cap", 429, "Bugün en fazla 3 acil çağrı açabilirsin.")]
    [InlineData("email_unavailable", 503, "Şu an e-posta gönderemiyoruz. Biraz sonra yeniden dene.")]
    public async Task Problem_codes_map_to_Turkish_messages(string code, int status, string expected)
    {
        var api = Client(_ => Http.Done(Http.Problem(status, code, "English server title")), out _);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            api.SignInAsync("elif@ornek.test", "x", TestContext.Current.CancellationToken));

        Assert.Equal(expected, error.Message);
        Assert.Equal(code, error.Code);
        Assert.Equal(status, error.Status);
        Assert.Equal("English server title", error.ServerTitle);
    }

    [Fact]
    public async Task Validation_errors_keep_the_field_messages()
    {
        var api = Client(_ => Http.Done(Http.Problem(400, "validation_failed", "Validation failed",
            new Dictionary<string, string[]> { ["password"] = ["too short"] })), out _);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            api.RegisterAsync("elif@ornek.test", "x", "Elif", TestContext.Current.CancellationToken));

        Assert.Equal(ApiErrorKind.Client, error.Kind);
        Assert.False(error.IsTransient);
        Assert.Equal(["too short"], error.FieldErrors["password"]);
    }

    [Fact]
    public async Task A_status_without_a_known_code_falls_back_by_status()
    {
        var api = Client(_ => Http.Done(Http.Problem(404, "http_404")), out _);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            api.GetStationAsync(Guid.NewGuid(), TestContext.Current.CancellationToken));

        Assert.Equal("Aradığın kayıt bulunamadı.", error.Message);
    }

    [Fact]
    public async Task A_non_json_5xx_is_a_transient_server_error()
    {
        var api = Client(_ => Http.Done(new HttpResponseMessage(HttpStatusCode.BadGateway)
        {
            Content = new StringContent("<html>bad gateway</html>", Encoding.UTF8, "text/html"),
        }), out _);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            api.GetStationAsync(Guid.NewGuid(), TestContext.Current.CancellationToken));

        Assert.Equal(ApiErrorKind.Server, error.Kind);
        Assert.Equal("http_502", error.Code);
        Assert.True(error.IsTransient);
        Assert.Equal(ErrorMessages.Server, error.Message);
    }

    [Fact]
    public async Task No_connection_is_a_transient_network_error()
    {
        var api = Client(_ => throw new HttpRequestException("Network is unreachable"), out _);

        var error = await Assert.ThrowsAsync<ApiException>(() =>
            api.RegisterAsync("elif@ornek.test", "kedimamasi1234", "Elif", TestContext.Current.CancellationToken));

        Assert.Equal(ApiErrorKind.Network, error.Kind);
        Assert.True(error.IsTransient);
        Assert.Equal(ErrorMessages.Network, error.Message);
    }

    [Fact]
    public async Task Every_post_carries_an_idempotency_key_and_gets_do_not()
    {
        var api = Client(request => Http.Done(request.Method == HttpMethod.Post
            ? Http.Json(HttpStatusCode.Accepted, new { status = "verification_pending" })
            : Http.Problem(404, "http_404")), out var handler);

        await api.RegisterAsync("elif@ornek.test", "kedimamasi1234", "Elif", TestContext.Current.CancellationToken);
        await api.RegisterAsync("elif@ornek.test", "kedimamasi1234", "Elif", TestContext.Current.CancellationToken);
        await Assert.ThrowsAsync<ApiException>(() => api.GetStationAsync(Guid.NewGuid(), TestContext.Current.CancellationToken));

        var keys = handler.Requests.Where(r => r.Method == HttpMethod.Post).Select(r => r.IdempotencyKey).ToArray();
        Assert.All(keys, key => Assert.True(Guid.TryParse(key, out _)));
        Assert.NotEqual(keys[0], keys[1]);
        Assert.Null(handler.Requests.Single(r => r.Method == HttpMethod.Get).IdempotencyKey);
    }

    [Fact]
    public async Task A_six_digit_code_is_sent_with_the_email_and_starts_the_session()
    {
        const string user = "4f1c2b8e-0000-4000-8000-000000000002";
        var api = Client(_ => Http.Done(Http.Json(HttpStatusCode.OK, Http.Tokens(user, "v"))), out var handler);

        var signedIn = await api.VerifyEmailAsync(" elif@ornek.test ", " 482913 ", TestContext.Current.CancellationToken);

        Assert.True(signedIn);
        Assert.Equal(user, api.Tokens.UserId);
        using var body = JsonDocument.Parse(handler.Requests.Single().Body!);
        Assert.Equal(["email", "code"], body.RootElement.EnumerateObject().Select(p => p.Name));
        Assert.Equal("elif@ornek.test", body.RootElement.GetProperty("email").GetString());
        Assert.Equal("482913", body.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_rejected_feeding_is_not_resent_with_a_different_body()
    {
        var api = Client(request => Http.Done(request.Path == "/v1/auth/login"
            ? Http.Json(HttpStatusCode.OK, Http.Tokens("4f1c2b8e-0000-4000-8000-000000000003", "a"))
            : Http.Problem(400, "validation_failed", "Validation failed",
                new Dictionary<string, string[]> { ["clientCreatedAt"] = ["too old"] })), out var handler);
        await api.SignInAsync("elif@ornek.test", "kedimamasi1234", TestContext.Current.CancellationToken);
        var tappedAt = new DateTimeOffset(2026, 10, 20, 7, 52, 0, TimeSpan.Zero);

        var error = await Assert.ThrowsAsync<ApiException>(() => api.CreateFeedingAsync(Guid.NewGuid(), new FeedingDraft(),
            "8a1f0f5e-0000-4000-8000-000000000001", tappedAt, ct: TestContext.Current.CancellationToken));

        var feeding = Assert.Single(handler.Requests, r => r.Path.EndsWith("/feedings", StringComparison.Ordinal));
        using var body = JsonDocument.Parse(feeding.Body!);
        Assert.Equal(tappedAt, body.RootElement.GetProperty("clientCreatedAt").GetDateTimeOffset());
        Assert.Equal(["too old"], error.FieldErrors["clientCreatedAt"]);
    }

    [Fact]
    public void The_map_area_uses_the_api_bbox_order_and_invariant_numbers()
    {
        var culture = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("tr-TR");
            var area = new MapArea(40.98, 29.02, 40.99, 29.035, 15);
            Assert.Equal("29.02,40.98,29.035,40.99", area.ToBbox());
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = culture;
        }
    }
}
