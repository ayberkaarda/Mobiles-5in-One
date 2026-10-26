using System.Net;
using System.Net.Http.Json;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.SecurityTests;

public sealed class RateLimitTests
{
    private const string Proxy = "10.20.30.40";

    [Theory]
    [InlineData(null, Proxy)]
    [InlineData("wrong", Proxy)]
    [InlineData("shared-test-key", "198.51.100.77")]
    public async Task UnauthenticatedBffClaimsCannotRotateTheClientBucket(string? key, string peer)
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Network:BffAddress"] = Proxy;
        factory.Settings["Network:BffSharedKey"] = "shared-test-key";
        using var client = factory.CreateApiClient(peer: peer);
        for (var i = 0; i < 6; i++)
        {
            using var response = await SendBff(client, $"192.0.2.{i + 1}", key);
            Assert.Equal(i < 5 ? HttpStatusCode.Unauthorized : HttpStatusCode.TooManyRequests, response.StatusCode);
        }
    }

    [Fact]
    public async Task VerifiedBffClientsHaveIndependentBucketsEvenWhenForwardedForIsSpoofed()
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Network:BffAddress"] = Proxy;
        factory.Settings["Network:BffSharedKey"] = "shared-test-key";
        factory.Settings["Network:TrustedProxies:0"] = Proxy;
        using var client = factory.CreateApiClient(peer: Proxy);
        for (var i = 0; i < 5; i++)
        {
            using var first = await SendBff(client, "192.0.2.1", "shared-test-key");
            using var second = await SendBff(client, "192.0.2.2", "shared-test-key");
            Assert.Equal(HttpStatusCode.Unauthorized, first.StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, second.StatusCode);
        }
        using var limited = await SendBff(client, "192.0.2.1", "shared-test-key");
        await AssertThrottledAsync(limited);
        using var other = await SendBff(client, "192.0.2.3", "shared-test-key");
        Assert.Equal(HttpStatusCode.Unauthorized, other.StatusCode);
    }

    private static Task<HttpResponseMessage> SendBff(HttpClient client, string address, string? key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/auth/login")
        {
            Content = JsonContent.Create(new LoginRequest(NewEmail(), "wrong-password-123"))
        };
        request.Headers.Add("X-Patika-Client-Ip", address);
        request.Headers.Add("X-Forwarded-For", "192.0.2.200");
        if (key is not null) request.Headers.Add("X-Patika-Bff-Key", key);
        return client.SendAsync(request, Ct);
    }

    [Fact]
    public async Task SixthLoginFromOneAddressWithinFifteenMinutesIs429WithRetryAfter()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();

        for (var i = 1; i <= 5; i++)
        {
            using var allowed = await client.LoginAsync(NewEmail(), "yanlis-sifre-123");
            Assert.Equal(HttpStatusCode.Unauthorized, allowed.StatusCode);
        }

        using var sixth = await client.LoginAsync(NewEmail(), "yanlis-sifre-123");

        await AssertThrottledAsync(sixth);
    }

    [Fact]
    public async Task SpoofedForwardedForFromAnUntrustedPeerDoesNotBypassTheLimit()
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Network:TrustedProxies:0"] = Proxy;
        using var client = factory.CreateApiClient(peer: "198.51.100.77");

        for (var i = 1; i <= 5; i++)
        {
            using var allowed = await SendWithForwardedFor(client, $"192.0.2.{i}");
            Assert.Equal(HttpStatusCode.Unauthorized, allowed.StatusCode);
        }

        using var sixth = await SendWithForwardedFor(client, "192.0.2.200");

        await AssertThrottledAsync(sixth);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SpoofedForwardedForWithTheDefaultConfigurationDoesNotBypassTheLimit(bool blankEnvEntry)
    {
        // No trusted proxy (absent, or the blank entry .env.example ships): forwarded headers are ignored.
        await using var factory = new PatikaApiFactory();
        if (blankEnvEntry)
        {
            factory.Settings["Network:TrustedProxies:0"] = "";
        }

        using var client = factory.CreateApiClient(peer: "198.51.100.77");

        for (var i = 1; i <= 5; i++)
        {
            using var allowed = await SendWithForwardedFor(client, $"192.0.2.{i}");
            Assert.Equal(HttpStatusCode.Unauthorized, allowed.StatusCode);
        }

        using var sixth = await SendWithForwardedFor(client, "192.0.2.200");

        await AssertThrottledAsync(sixth);
    }

    [Fact]
    public async Task Ipv6AddressesInsideOneSlash64ShareOneBudget()
    {
        await using var factory = new PatikaApiFactory();

        for (var i = 1; i <= 5; i++)
        {
            using var rotating = factory.CreateApiClient(peer: $"2001:db8:1:2::{i:x}");
            using var allowed = await rotating.LoginAsync(NewEmail(), "yanlis-sifre-123");
            Assert.Equal(HttpStatusCode.Unauthorized, allowed.StatusCode);
        }

        using var sameSlash64 = factory.CreateApiClient(peer: "2001:db8:1:2:ffff:ffff:ffff:fffe");
        using var sixth = await sameSlash64.LoginAsync(NewEmail(), "yanlis-sifre-123");
        await AssertThrottledAsync(sixth);

        using var otherSlash64 = factory.CreateApiClient(peer: "2001:db8:1:3::1");
        using var other = await otherSlash64.LoginAsync(NewEmail(), "yanlis-sifre-123");
        Assert.Equal(HttpStatusCode.Unauthorized, other.StatusCode);
    }

    [Fact]
    public async Task Ipv4MappedAddressSharesTheIpv4Budget()
    {
        await using var factory = new PatikaApiFactory();

        for (var i = 1; i <= 5; i++)
        {
            using var mixed = factory.CreateApiClient(peer: i % 2 == 0 ? "::ffff:203.0.113.10" : "203.0.113.10");
            using var allowed = await mixed.LoginAsync(NewEmail(), "yanlis-sifre-123");
            Assert.Equal(HttpStatusCode.Unauthorized, allowed.StatusCode);
        }

        using var mapped = factory.CreateApiClient(peer: "::ffff:203.0.113.10");
        using var sixth = await mapped.LoginAsync(NewEmail(), "yanlis-sifre-123");
        await AssertThrottledAsync(sixth);
    }

    [Fact]
    public async Task ForwardedForIsHonouredOnlyFromAConfiguredProxy()
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Network:TrustedProxies:0"] = Proxy;
        using var client = factory.CreateApiClient(peer: Proxy);

        // Six distinct real clients behind the trusted proxy each get their own budget.
        for (var i = 1; i <= 6; i++)
        {
            using var response = await SendWithForwardedFor(client, $"192.0.2.{i}");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        // A single client behind the proxy is still limited.
        for (var i = 1; i <= 4; i++)
        {
            using var response = await SendWithForwardedFor(client, "192.0.2.1");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        using var throttled = await SendWithForwardedFor(client, "192.0.2.1");
        await AssertThrottledAsync(throttled);
    }

    [Fact]
    public async Task NormalizedEmailIsLimitedAcrossAddresses()
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Network:TrustedProxies:0"] = Proxy;
        using var client = factory.CreateApiClient(peer: Proxy);
        var email = NewEmail("hedef");

        for (var i = 1; i <= 5; i++)
        {
            using var allowed = await SendWithForwardedFor(client, $"192.0.2.{i}", email);
            Assert.Equal(HttpStatusCode.Unauthorized, allowed.StatusCode);
        }

        using var sixth = await SendWithForwardedFor(client, "192.0.2.99", email.ToUpperInvariant());

        await AssertThrottledAsync(sixth);
    }

    [Fact]
    public async Task ExternalSignInIsLimitedToTenPerFifteenMinutes()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();

        for (var i = 1; i <= 10; i++)
        {
            using var allowed = await client.PostAsJsonAsync("/v1/auth/google", new GoogleSignInRequest("h.unknown.s"), Ct);
            Assert.Equal(HttpStatusCode.Unauthorized, allowed.StatusCode);
        }

        using var eleventh = await client.PostAsJsonAsync("/v1/auth/google", new GoogleSignInRequest("h.unknown.s"), Ct);

        await AssertThrottledAsync(eleventh);
    }

    [Fact]
    public async Task RefreshIsLimitedToThirtyPerMinutePerUser()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();
        var refreshToken = (await client.RegisterAsync(factory, NewEmail())).RefreshToken;

        for (var i = 1; i <= 30; i++)
        {
            using var response = await client.RefreshAsync(refreshToken);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            refreshToken = (await response.Content.ReadFromJsonAsync<TokenResponse>(Ct))!.RefreshToken;
        }

        using var limited = await client.RefreshAsync(refreshToken);
        await AssertThrottledAsync(limited);

        // The throttled token was not consumed and works once the window allows it again.
        Assert.Null(factory.Store.Tokens.Single(t => t.TokenHash.SequenceEqual(
            Patika.Api.Security.Tokens.RefreshTokens.Hash(refreshToken))).RevokedAt);
    }

    [Fact]
    public async Task GlobalLimitIsThreeHundredRequestsPerMinutePerAddress()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();

        for (var i = 1; i <= 300; i++)
        {
            using var ok = await client.GetAsync("/v1/health", Ct);
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }

        using var limited = await client.GetAsync("/v1/health", Ct);
        await AssertThrottledAsync(limited);

        using var otherAddress = factory.CreateApiClient(peer: "203.0.113.99");
        using var fine = await otherAddress.GetAsync("/v1/health", Ct);
        Assert.Equal(HttpStatusCode.OK, fine.StatusCode);
    }

    private static Task<HttpResponseMessage> SendWithForwardedFor(HttpClient client, string forwardedFor, string? email = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/auth/login")
        {
            Content = JsonContent.Create(new LoginRequest(email ?? NewEmail(), "yanlis-sifre-123")),
        };
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        return client.SendAsync(request, Ct);
    }

    private static async Task AssertThrottledAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        var retryAfter = response.Headers.RetryAfter;
        Assert.NotNull(retryAfter);
        Assert.True(retryAfter.Delta > TimeSpan.Zero, $"Retry-After was {retryAfter}");
        Assert.Equal(AuthErrorCodes.RateLimited, (await response.ReadProblemAsync()).Code);
        response.AssertSecurityHeaders();
    }
}
