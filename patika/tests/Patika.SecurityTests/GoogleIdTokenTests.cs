using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Patika.Api.Features.Auth;
using Xunit;

namespace Patika.SecurityTests;

/// <summary>
/// The real Google verifier against a local JWKS (no network): signature, aud, iss and exp are all enforced.
/// </summary>
public sealed class GoogleIdTokenTests : IDisposable
{
    private const string AndroidClientId = "1234-android.apps.googleusercontent.com";
    private readonly RSA googleRsa = RSA.Create(2048);
    private readonly RSA attackerRsa = RSA.Create(2048);
    private readonly RsaSecurityKey googleKey;
    private readonly RsaSecurityKey attackerKey;
    private readonly GoogleIdTokenVerifier verifier;

    public GoogleIdTokenTests()
    {
        googleKey = new RsaSecurityKey(googleRsa) { KeyId = "google-1", CryptoProviderFactory = new CryptoProviderFactory() };
        attackerKey = new RsaSecurityKey(attackerRsa) { KeyId = "google-1", CryptoProviderFactory = new CryptoProviderFactory() };
        var configuration = new OpenIdConnectConfiguration { Issuer = "https://accounts.google.com" };
        configuration.SigningKeys.Add(googleKey);
        verifier = new GoogleIdTokenVerifier(
            new StaticConfigurationManager<OpenIdConnectConfiguration>(configuration),
            Options.Create(new GoogleSettings { ClientIds = [AndroidClientId] }),
            TimeProvider.System,
            NullLogger<GoogleIdTokenVerifier>.Instance);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public void Dispose()
    {
        googleRsa.Dispose();
        attackerRsa.Dispose();
    }

    [Theory]
    [InlineData("https://accounts.google.com")]
    [InlineData("accounts.google.com")]
    public async Task GenuineTokenYieldsTheIdentity(string issuer)
    {
        var identity = await verifier.VerifyAsync(Token(issuer: issuer), Ct);

        Assert.NotNull(identity);
        Assert.Equal("google", identity.Provider);
        Assert.Equal("110248495921238986420", identity.Subject);
        Assert.Equal("kedi.dostu@gmail.com", identity.Email);
        Assert.True(identity.EmailVerified);
    }

    [Fact]
    public async Task UnverifiedEmailIsReportedAsUnverified()
    {
        var identity = await verifier.VerifyAsync(Token(emailVerified: false), Ct);

        Assert.NotNull(identity);
        Assert.False(identity.EmailVerified);
    }

    public static TheoryData<string> Forgeries() =>
        ["wrong-audience", "web-client-audience", "wrong-issuer", "expired", "attacker-key", "hs256", "no-subject"];

    [Theory]
    [MemberData(nameof(Forgeries))]
    public async Task ForgedOrMisdirectedTokensAreRejected(string forgery)
    {
        var token = forgery switch
        {
            "wrong-audience" => Token(audience: "another-app.apps.googleusercontent.com"),
            "web-client-audience" => Token(audience: "1234-web.apps.googleusercontent.com"),
            "wrong-issuer" => Token(issuer: "https://accounts.google.com.evil.example"),
            "expired" => Token(expires: DateTime.UtcNow.AddMinutes(-10)),
            "attacker-key" => Token(key: attackerKey),
            "hs256" => Token(credentials: new SigningCredentials(
                new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(32)), SecurityAlgorithms.HmacSha256)),
            "no-subject" => Token(subject: null),
            _ => throw new InvalidOperationException(forgery),
        };

        Assert.Null(await verifier.VerifyAsync(token, Ct));
    }

    [Fact]
    public async Task NoConfiguredClientIdRejectsEverything()
    {
        var unconfigured = new GoogleIdTokenVerifier(
            new StaticConfigurationManager<OpenIdConnectConfiguration>(new OpenIdConnectConfiguration()),
            Options.Create(new GoogleSettings()),
            TimeProvider.System,
            NullLogger<GoogleIdTokenVerifier>.Instance);

        Assert.Null(await unconfigured.VerifyAsync(Token(), Ct));
    }

    private string Token(
        string issuer = "https://accounts.google.com",
        string audience = AndroidClientId,
        DateTime? expires = null,
        RsaSecurityKey? key = null,
        SigningCredentials? credentials = null,
        string? subject = "110248495921238986420",
        bool emailVerified = true)
    {
        var exp = expires ?? DateTime.UtcNow.AddMinutes(30);
        var claims = new List<Claim>
        {
            new("email", "kedi.dostu@gmail.com"),
            new("email_verified", emailVerified ? "true" : "false", ClaimValueTypes.Boolean),
            new("name", "Kedi Dostu"),
        };
        if (subject is not null)
        {
            claims.Add(new Claim("sub", subject));
        }

        return new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false }.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            IssuedAt = exp.AddHours(-1),
            NotBefore = exp.AddHours(-1),
            Expires = exp,
            Subject = new ClaimsIdentity(claims),
            SigningCredentials = credentials ?? new SigningCredentials(key ?? googleKey, SecurityAlgorithms.RsaSha256),
        });
    }
}
