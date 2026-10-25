using System.Net;
using Patika.App.Core.Api;
using Patika.Contracts.Auth;
using Xunit;

namespace Patika.App.Tests;

public sealed class TokenRefreshTests
{
    private const string UserId = "4f1c2b8e-0000-4000-8000-000000000001";

    private readonly ManualClock clock = new();
    private readonly MemoryTokenStore store = new();

    private (PatikaApiClient Api, FakeHandler Handler) Client(Func<RecordedRequest, Task<HttpResponseMessage>> respond)
    {
        var handler = new FakeHandler(respond);
        var tokens = new TokenManager(store, clock);
        var api = new PatikaApiClient(new HttpClient(handler), tokens, new ApiOptions { BaseAddress = new Uri("http://api.test/") });
        return (api, handler);
    }

    private static MeResponse Me() => new(Guid.Parse(UserId), "elif@ornek.test", "Elif", "Volunteer", true, 3, ["first_feeding"], DateTimeOffset.UnixEpoch);

    [Fact]
    public async Task Concurrent_requests_with_an_expired_token_share_one_refresh()
    {
        store.Session = new StoredSession("refresh-0", UserId);
        var refreshes = 0;
        var gate = new TaskCompletionSource();
        var (api, handler) = Client(async request =>
        {
            if (request.Path == "/v1/auth/refresh")
            {
                Interlocked.Increment(ref refreshes);
                await gate.Task;
                return Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "1"));
            }

            return request.Bearer == Http.Jwt(UserId, "1")
                ? Http.Json(HttpStatusCode.OK, Me())
                : Http.Problem(401, "http_401");
        });

        var calls = Enumerable.Range(0, 10).Select(_ => api.GetMeAsync(TestContext.Current.CancellationToken)).ToArray();
        await Task.Delay(50, TestContext.Current.CancellationToken);
        gate.SetResult();
        var results = await Task.WhenAll(calls);

        Assert.Equal(1, refreshes);
        Assert.All(results, me => Assert.Equal("Elif", me.DisplayName));
        Assert.Equal("refresh-1", store.Session?.RefreshToken);
        Assert.Equal(1, handler.Count("/v1/auth/refresh"));
    }

    [Fact]
    public async Task A_401_with_a_live_token_refreshes_once_and_retries_with_the_new_token()
    {
        var (api, handler) = Client(request => Http.Done(request.Path switch
        {
            "/v1/auth/login" => Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "a")),
            "/v1/auth/refresh" => Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "b")),
            _ when request.Bearer == Http.Jwt(UserId, "b") => Http.Json(HttpStatusCode.OK, Me()),
            _ => Http.Problem(401, "http_401"),
        }));

        await api.SignInAsync("elif@ornek.test", "kedimamasi1234", TestContext.Current.CancellationToken);
        var me = await api.GetMeAsync(TestContext.Current.CancellationToken);

        Assert.Equal("Elif", me.DisplayName);
        var meCalls = handler.Requests.Where(r => r.Path == "/v1/me").Select(r => r.Bearer ?? "").ToArray();
        Assert.Equal<string>([Http.Jwt(UserId, "a"), Http.Jwt(UserId, "b")], meCalls);
        Assert.Equal(1, handler.Count("/v1/auth/refresh"));
    }

    [Fact]
    public async Task A_401_after_refresh_ends_the_session_and_wipes_tokens()
    {
        var (api, _) = Client(request => Http.Done(request.Path switch
        {
            "/v1/auth/login" => Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "a")),
            "/v1/auth/refresh" => Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "b")),
            _ => Http.Problem(401, "http_401"),
        }));
        var expired = 0;
        api.Tokens.SessionExpired += (_, _) => expired++;

        await api.SignInAsync("elif@ornek.test", "kedimamasi1234", TestContext.Current.CancellationToken);
        var error = await Assert.ThrowsAsync<ApiException>(() => api.GetMeAsync(TestContext.Current.CancellationToken));

        Assert.Equal(ApiErrorKind.SignInRequired, error.Kind);
        Assert.Equal(1, expired);
        Assert.Null(store.Session);
        Assert.Null(api.Tokens.CurrentAccessToken);
    }

    [Theory]
    [InlineData("refresh_reused")]
    [InlineData("refresh_invalid")]
    public async Task A_rejected_refresh_token_ends_the_session(string code)
    {
        store.Session = new StoredSession("refresh-0", UserId);
        var (api, _) = Client(request => Http.Done(request.Path == "/v1/auth/refresh"
            ? Http.Problem(401, code)
            : Http.Json(HttpStatusCode.OK, Me())));
        var expired = 0;
        api.Tokens.SessionExpired += (_, _) => expired++;

        var error = await Assert.ThrowsAsync<ApiException>(() => api.GetMeAsync(TestContext.Current.CancellationToken));

        Assert.Equal(ApiErrorKind.SignInRequired, error.Kind);
        Assert.Equal(1, expired);
        Assert.Null(store.Session);
    }

    [Fact]
    public async Task A_refresh_that_cannot_reach_the_server_keeps_the_session()
    {
        store.Session = new StoredSession("refresh-0", UserId);
        var (api, _) = Client(_ => throw new HttpRequestException("offline"));

        var error = await Assert.ThrowsAsync<ApiException>(() => api.GetMeAsync(TestContext.Current.CancellationToken));

        Assert.Equal(ApiErrorKind.Network, error.Kind);
        Assert.Equal("refresh-0", store.Session?.RefreshToken);
    }

    [Fact]
    public async Task The_access_token_is_refreshed_shortly_before_it_expires()
    {
        var (api, handler) = Client(request => Http.Done(request.Path switch
        {
            "/v1/auth/login" => Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "a", expiresIn: 900)),
            "/v1/auth/refresh" => Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "b")),
            _ => Http.Json(HttpStatusCode.OK, Me()),
        }));

        await api.SignInAsync("elif@ornek.test", "kedimamasi1234", TestContext.Current.CancellationToken);
        await api.GetMeAsync(TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromSeconds(900) - TokenManager.ExpirySkew + TimeSpan.FromSeconds(1));
        await api.GetMeAsync(TestContext.Current.CancellationToken);

        Assert.Equal(1, handler.Count("/v1/auth/refresh"));
        Assert.Equal(Http.Jwt(UserId, "b"), handler.Requests.Last().Bearer);
    }

    [Fact]
    public async Task Sign_out_wipes_tokens_even_when_the_server_is_unreachable()
    {
        var online = true;
        var (api, _) = Client(_ => online
            ? Http.Done(Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "a")))
            : throw new HttpRequestException("offline"));
        var signedOut = 0;
        api.Tokens.SignedOut += (_, _) => signedOut++;

        await api.SignInAsync("elif@ornek.test", "kedimamasi1234", TestContext.Current.CancellationToken);
        Assert.Equal(UserId, store.Session?.UserId);
        online = false;
        await api.SignOutAsync(TestContext.Current.CancellationToken);

        Assert.Null(store.Session);
        Assert.Null(api.Tokens.CurrentAccessToken);
        Assert.Null(api.Tokens.UserId);
        Assert.Equal(1, signedOut);
    }

    [Fact]
    public async Task Guest_requests_go_without_a_token_and_required_ones_fail_fast()
    {
        var (api, handler) = Client(_ => Http.Done(Http.Json(HttpStatusCode.OK,
            new Patika.Contracts.Community.PageResponse<Patika.Contracts.Community.MapFeature>([], 1, 200, false))));

        await api.GetStationsAsync(new MapArea(40.98, 29.02, 40.99, 29.03, 15), ct: TestContext.Current.CancellationToken);
        var error = await Assert.ThrowsAsync<ApiException>(() => api.GetMeAsync(TestContext.Current.CancellationToken));

        Assert.Null(handler.Requests.Single().Bearer);
        Assert.Equal(ApiErrorKind.SignInRequired, error.Kind);
    }

    /// <summary>A refresh held at the server until the test releases it.</summary>
    private (PatikaApiClient Api, TaskCompletionSource Arrived, TaskCompletionSource Release) HeldRefresh(string salt)
    {
        var arrived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var (api, _) = Client(async request =>
        {
            if (request.Path == "/v1/auth/refresh")
            {
                arrived.SetResult();
                await release.Task;
                return Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, salt));
            }

            return Http.Json(HttpStatusCode.OK, Me());
        });
        return (api, arrived, release);
    }

    [Fact]
    public async Task A_refresh_that_finishes_after_sign_out_does_not_write_the_tokens_back()
    {
        store.Session = new StoredSession("refresh-0", UserId);
        var (api, arrived, release) = HeldRefresh("late");

        var call = api.GetMeAsync(TestContext.Current.CancellationToken);
        await arrived.Task;
        await api.Tokens.SignOutAsync();
        release.SetResult();
        await Assert.ThrowsAsync<ApiException>(() => call);

        Assert.Null(store.Session);
        Assert.Null(api.Tokens.CurrentAccessToken);
        Assert.Null(api.Tokens.UserId);
    }

    [Fact]
    public async Task A_refresh_that_finishes_after_an_account_switch_does_not_overwrite_the_new_account()
    {
        const string other = "4f1c2b8e-0000-4000-8000-0000000000bb";
        store.Session = new StoredSession("refresh-0", UserId);
        var (api, arrived, release) = HeldRefresh("late");

        var call = api.GetMeAsync(TestContext.Current.CancellationToken);
        await arrived.Task;
        await api.Tokens.AcceptAsync(Http.Tokens(other, "b"));
        release.SetResult();
        await Assert.ThrowsAsync<ApiException>(() => call);

        Assert.Equal(new StoredSession("refresh-b", other), store.Session);
        Assert.Equal(Http.Jwt(other, "b"), api.Tokens.CurrentAccessToken);
        Assert.Equal(other, api.Tokens.UserId);
    }
}
