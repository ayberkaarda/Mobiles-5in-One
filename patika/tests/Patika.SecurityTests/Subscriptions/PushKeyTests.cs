using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using Patika.Api.Features.Subscriptions;
using Xunit;

namespace Patika.SecurityTests.Subscriptions;

/// <summary>Algorithm pinning, key id lookup and key-set refresh for the Play push identity token.</summary>
public sealed class PushKeyTests : IDisposable
{
    private const string Audience = "https://local.test/webhooks/play";
    private const string Email = "push@local.test";
    private readonly RSA first = RSA.Create(2048);
    private readonly RSA second = RSA.Create(2048);
    private readonly ManualClock clock = new(new DateTimeOffset(2026, 10, 26, 9, 0, 0, TimeSpan.Zero));

    public void Dispose()
    {
        first.Dispose();
        second.Dispose();
    }

    [Fact]
    public async Task CorrectlySignedTokenWithAnotherRsaAlgorithmIsRejected()
    {
        var keys = new KeySet(Jwks(Key(first, "a")));
        var verifier = Verifier(keys);
        Assert.True(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256), Ct));
        Assert.False(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha384), Ct));
        Assert.False(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSsaPssSha256), Ct));
    }

    [Fact]
    public async Task SymmetricAndUnsignedTokensAreRejected()
    {
        var verifier = Verifier(new KeySet(Jwks(Key(first, "a"))));
        var secret = new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(32)) { KeyId = "a" };
        Assert.False(await verifier.VerifyAsync(Bearer(secret, SecurityAlgorithms.HmacSha256), Ct));

        var header = Base64UrlEncoder.Encode("""{"alg":"none","typ":"JWT","kid":"a"}""");
        var now = clock.GetUtcNow().ToUnixTimeSeconds();
        var body = Base64UrlEncoder.Encode(JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["iss"] = "https://accounts.google.com",
            ["aud"] = Audience,
            ["email"] = Email,
            ["email_verified"] = true,
            ["iat"] = now,
            ["exp"] = now + 300,
        }));
        Assert.False(await verifier.VerifyAsync($"Bearer {header}.{body}.", Ct));
    }

    [Fact]
    public async Task UnknownKeyIdRefreshesTheKeySetAtMostOncePerMinute()
    {
        var keys = new KeySet(Jwks(Key(first, "a")));
        var verifier = Verifier(keys);
        Assert.True(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256), Ct));
        Assert.Equal(1, keys.Fetches);

        // Google rotated: the new key id is published after the first fetch.
        keys.Json = Jwks(Key(first, "a"), Key(second, "b"));
        Assert.False(await verifier.VerifyAsync(Bearer(Key(second, "b"), SecurityAlgorithms.RsaSha256), Ct));
        Assert.Equal(1, keys.Fetches);
        clock.Advance(TimeSpan.FromMinutes(2));
        Assert.True(await verifier.VerifyAsync(Bearer(Key(second, "b"), SecurityAlgorithms.RsaSha256), Ct));
        Assert.Equal(2, keys.Fetches);

        // A key id that is not published at all never validates, even when signed by a known key.
        using var stranger = RSA.Create(2048);
        Assert.False(await verifier.VerifyAsync(Bearer(Key(stranger, "c"), SecurityAlgorithms.RsaSha256), Ct));
        Assert.Equal(2, keys.Fetches);
    }

    [Fact]
    public async Task UnreachableKeySetRejectsUnknownKeysButKeepsTheLastGoodSet()
    {
        var keys = new KeySet(Jwks(Key(first, "a")));
        var verifier = Verifier(keys);
        Assert.True(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256), Ct));
        keys.Fail = true;
        clock.Advance(TimeSpan.FromMinutes(2));
        Assert.False(await verifier.VerifyAsync(Bearer(Key(second, "b"), SecurityAlgorithms.RsaSha256), Ct));
        keys.Json = "not json";
        keys.Fail = false;
        clock.Advance(TimeSpan.FromHours(2));
        // The cached key set is old and the refresh returns garbage: a genuine push still verifies.
        Assert.True(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256), Ct));
        Assert.Equal(3, keys.Fetches);
    }

    [Fact]
    public async Task MalformedOrForeignTokensNeverFetchKeys()
    {
        var keys = new KeySet(Jwks(Key(first, "a")));
        var verifier = Verifier(keys);
        var secret = new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(32)) { KeyId = "a" };
        foreach (var bearer in new[]
        {
            "Bearer x", "Bearer a.b.c", "Bearer " + new string('a', 9000),
            Bearer(secret, SecurityAlgorithms.HmacSha256),
            Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha384),
            Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256, audience: "someone-else"),
            Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256, issuer: "https://evil.test"),
            Bearer(new RsaSecurityKey(first), SecurityAlgorithms.RsaSha256),
        })
        {
            Assert.False(await verifier.VerifyAsync(bearer, Ct));
        }
        Assert.Equal(0, keys.Fetches);
    }

    [Theory]
    [InlineData("http")]
    [InlineData("malformed")]
    [InlineData("empty")]
    public async Task FloodAfterAFailedFetchMakesAtMostOneFetchPerWindowAndBacksOff(string failure)
    {
        var keys = new KeySet(Jwks(Key(first, "a")));
        var verifier = Verifier(keys);
        Assert.True(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256), Ct));
        keys.Fail = failure == "http";
        if (failure == "malformed") keys.Json = "{\"keys\":[{\"kty\":";
        if (failure == "empty") keys.Json = """{"keys":[]}""";
        using var stranger = RSA.Create(2048);
        var unknown = Bearer(Key(stranger, "z"), SecurityAlgorithms.RsaSha256);
        var genuine = Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256);

        clock.Advance(TimeSpan.FromMinutes(2));
        for (var i = 0; i < 50; i++) Assert.False(await verifier.VerifyAsync(unknown, Ct));
        Assert.Equal(2, keys.Fetches);
        // During the outage a push signed with a cached key is still accepted, without a fetch.
        Assert.True(await verifier.VerifyAsync(genuine, Ct));
        Assert.Equal(2, keys.Fetches);

        // Backoff doubles after each failed attempt: 1, 2, 4 minutes, then capped at 5.
        clock.Advance(TimeSpan.FromSeconds(61));
        Assert.False(await verifier.VerifyAsync(unknown, Ct));
        Assert.Equal(3, keys.Fetches);
        clock.Advance(TimeSpan.FromSeconds(61));
        Assert.False(await verifier.VerifyAsync(unknown, Ct));
        Assert.Equal(3, keys.Fetches);
        clock.Advance(TimeSpan.FromSeconds(60));
        Assert.False(await verifier.VerifyAsync(unknown, Ct));
        Assert.Equal(4, keys.Fetches);
        for (var i = 0; i < 3; i++)
        {
            clock.Advance(PlayPushVerifier.MaxBackoff - TimeSpan.FromSeconds(1));
            Assert.False(await verifier.VerifyAsync(Bearer(Key(stranger, "z"), SecurityAlgorithms.RsaSha256), Ct));
        }
        Assert.Equal(6, keys.Fetches);
        Assert.True(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256), Ct));

        // An expired token is refused before any key work.
        clock.Advance(PlayPushVerifier.MaxBackoff);
        Assert.False(await verifier.VerifyAsync(unknown, Ct));
        Assert.Equal(6, keys.Fetches);
    }

    [Fact]
    public async Task ConcurrentUnknownKeyRequestsShareOneFetchAndCachedKeysDoNotWait()
    {
        var keys = new KeySet(Jwks(Key(first, "a")));
        var verifier = Verifier(keys);
        Assert.True(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256), Ct));
        clock.Advance(TimeSpan.FromMinutes(2));
        keys.Hold = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        keys.Entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var stranger = RSA.Create(2048);
        var unknown = Bearer(Key(stranger, "z"), SecurityAlgorithms.RsaSha256);
        var flood = Enumerable.Range(0, 40).Select(_ => Task.Run(() => verifier.VerifyAsync(unknown, Ct), Ct)).ToArray();
        await keys.Entered.Task.WaitAsync(TimeSpan.FromSeconds(30), Ct);

        // The key set fetch hangs; a push signed with a cached key is verified without queueing behind it.
        var genuine = verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256), Ct);
        Assert.Same(genuine, await Task.WhenAny(genuine, Task.Delay(TimeSpan.FromSeconds(15), Ct)));
        Assert.True(await genuine);

        keys.Hold.SetResult();
        Assert.All(await Task.WhenAll(flood), Assert.False);
        Assert.Equal(2, keys.Fetches);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static RsaSecurityKey Key(RSA rsa, string kid) => new(rsa) { KeyId = kid };

    private static string Jwks(params RsaSecurityKey[] keys) => JsonSerializer.Serialize(new
    {
        keys = keys.Select(k =>
        {
            var jwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(new RsaSecurityKey(k.Rsa.ExportParameters(false)) { KeyId = k.KeyId });
            jwk.Alg = "RS256";
            jwk.Use = "sig";
            return jwk;
        }).ToArray(),
    });

    private PlayPushVerifier Verifier(KeySet keys)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Billing:Rtdn:Audience"] = Audience,
            ["Billing:Rtdn:Email"] = Email,
            ["Billing:Rtdn:JwksUrl"] = "https://local.test/keys",
        }).Build();
        return new PlayPushVerifier(new HttpClient(keys), config, clock);
    }

    private string Bearer(SecurityKey key, string algorithm, string audience = Audience, string issuer = "https://accounts.google.com")
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var handler = new JwtSecurityTokenHandler { SetDefaultTimesOnTokenCreation = false };
        return "Bearer " + handler.CreateEncodedJwt(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = now.AddMinutes(5),
            Claims = new Dictionary<string, object> { ["email"] = Email, ["email_verified"] = true },
            SigningCredentials = new SigningCredentials(key, algorithm),
        });
    }

    private sealed class KeySet(string json) : HttpMessageHandler
    {
        public string Json { get; set; } = json;
        private int fetches;
        public bool Fail { get; set; }
        public int Fetches => Volatile.Read(ref fetches);
        public TaskCompletionSource? Hold { get; set; }
        public TaskCompletionSource Entered { get; set; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref fetches);
            Entered.TrySetResult();
            if (Hold is { } hold) await hold.Task.WaitAsync(cancellationToken);
            return Fail
                ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Json, Encoding.UTF8, "application/json") };
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset now = start;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan by) => now += by;
    }
}
