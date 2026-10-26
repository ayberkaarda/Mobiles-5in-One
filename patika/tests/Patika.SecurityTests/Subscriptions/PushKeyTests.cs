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
    public async Task UnreachableKeySetRejectsInsteadOfThrowing()
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
        Assert.False(await verifier.VerifyAsync(Bearer(Key(first, "a"), SecurityAlgorithms.RsaSha256), Ct));
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

    private string Bearer(SecurityKey key, string algorithm)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var handler = new JwtSecurityTokenHandler { SetDefaultTimesOnTokenCreation = false };
        return "Bearer " + handler.CreateEncodedJwt(new SecurityTokenDescriptor
        {
            Issuer = "https://accounts.google.com",
            Audience = Audience,
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
        public bool Fail { get; set; }
        public int Fetches { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Fetches++;
            return Task.FromResult(Fail
                ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Json, Encoding.UTF8, "application/json") });
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset now = start;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan by) => now += by;
    }
}
