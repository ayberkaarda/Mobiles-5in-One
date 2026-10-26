using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Patika.Api.Features.Subscriptions;
using Patika.Infrastructure.Billing;
using Xunit;

namespace Patika.SecurityTests.Subscriptions;

public sealed class PushSignatureTests
{
    [Theory]
    [InlineData("valid", true)]
    [InlineData("missing", false)]
    [InlineData("signature", false)]
    [InlineData("audience", false)]
    [InlineData("email", false)]
    [InlineData("unverified", false)]
    [InlineData("expired", false)]
    [InlineData("future", false)]
    [InlineData("issuer", false)]
    public async Task ValidatesPushIdentityWithLocalRsaKeys(string scenario, bool expected)
    {
        using var rsa = RSA.Create(2048);
        using var wrong = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa) { KeyId = "test-key" };
        var jwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(key); jwk.Alg = "RS256"; jwk.Use = "sig";
        using var http = new HttpClient(new JwksHandler(JsonSerializer.Serialize(new { keys = new[] { jwk } })));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Billing:Rtdn:Audience"] = "https://local.test/webhooks/play",
            ["Billing:Rtdn:Email"] = "push@local.test",
            ["Billing:Rtdn:JwksUrl"] = "https://local.test/keys",
        }).Build();
        var now = DateTimeOffset.UtcNow;
        var signing = scenario == "signature" ? new RsaSecurityKey(wrong) { KeyId = "test-key" } : key;
        var jwt = new JwtSecurityTokenHandler().CreateEncodedJwt(new SecurityTokenDescriptor
        {
            Issuer = scenario == "issuer" ? "other" : "https://accounts.google.com",
            Audience = scenario == "audience" ? "wrong" : "https://local.test/webhooks/play",
            IssuedAt = now.AddMinutes(scenario == "future" ? 10 : -15).UtcDateTime,
            NotBefore = now.AddMinutes(-15).UtcDateTime,
            Expires = now.AddMinutes(scenario == "expired" ? -5 : 5).UtcDateTime,
            Claims = new Dictionary<string, object>
            {
                ["email"] = scenario == "email" ? "wrong@local.test" : "push@local.test",
                ["email_verified"] = scenario != "unverified"
            },
            SigningCredentials = new SigningCredentials(signing, SecurityAlgorithms.RsaSha256),
        });
        var verifier = new PlayPushVerifier(http, config, TimeProvider.System);
        Assert.Equal(expected, await verifier.VerifyAsync(scenario == "missing" ? null : "Bearer " + jwt, TestContext.Current.CancellationToken));
    }
    [Theory]
    [InlineData(false, false)]
    [InlineData(true, true)]
    public void ProductionFakeRequiresExplicitAllowance(bool allow, bool succeeds)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Billing:Provider"] = "Fake",
            ["Billing:AllowFake"] = allow.ToString(),
            ["DataProtection:KeysPath"] = Path.Combine(Path.GetTempPath(), "patika-billing-tests"),
        }).Build();
        var services = new ServiceCollection();
        if (succeeds) services.AddPlayBilling(config, false, true);
        else Assert.Throws<InvalidOperationException>(() => services.AddPlayBilling(config, false, true));
    }
    [Theory]
    [InlineData("Fake", true)]
    [InlineData("Google", true)]
    [InlineData("Google", false)]
    public void ProductionRefusesAnEphemeralKeyRingForPurchaseTokens(string provider, bool production)
    {
        // The Worker decrypts tokens the API encrypted; without the shared persistent ring reconciliation breaks.
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Billing:Provider"] = provider, ["Billing:AllowFake"] = "true", ["Billing:PackageName"] = BillingTokens.Package }).Build();
        var services = new ServiceCollection();
        if (production) Assert.Throws<InvalidOperationException>(() => services.AddPlayBilling(config, false, true));
        else services.AddPlayBilling(config, false, false);
    }
    private sealed class JwksHandler(string json) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
    }
}
