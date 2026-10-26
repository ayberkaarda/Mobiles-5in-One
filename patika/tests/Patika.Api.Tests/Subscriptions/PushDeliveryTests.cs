using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using Patika.Api.Features.Subscriptions;
using Patika.Api.Tests.Infrastructure;
using Patika.Infrastructure.Billing;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests.Subscriptions;

public sealed class PushDeliveryTests(PostgisFixture fixture) : IClassFixture<PostgisFixture>
{
    [Theory]
    [InlineData("normal", "app.patika.android", 1)]
    [InlineData("test", "app.patika.android", 1)]
    [InlineData("normal", "other.package", 0)]
    public async Task SignedDeliveryPersistsOnceAndIgnoresOtherPackages(string type, string package, int count)
    {
        using var rsa = RSA.Create(2048); var key = new RsaSecurityKey(rsa) { KeyId = "local" };
        var jwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(key);
        using var keys = new HttpClient(new KeysHandler(JsonSerializer.Serialize(new { keys = new[] { jwk } })));
        await using var factory = new PatikaApiFactory();
        factory.Settings["Billing:Rtdn:Audience"] = "local-push";
        factory.Settings["Billing:Rtdn:Email"] = "push@local.test";
        factory.ExtraServices = services =>
        {
            services.RemoveAll<PatikaDbContext>();
            services.AddScoped(_ => fixture.CreateContext());
            services.RemoveAll<PlayPushVerifier>();
            services.AddSingleton(sp => new PlayPushVerifier(keys, sp.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>(), TimeProvider.System));
        };
        using var client = factory.CreateClient();
        var now = DateTime.UtcNow;
        var jwt = new JwtSecurityTokenHandler().CreateEncodedJwt(new SecurityTokenDescriptor
        {
            Issuer = "https://accounts.google.com",
            Audience = "local-push",
            IssuedAt = now,
            Expires = now.AddMinutes(5),
            SigningCredentials = new(key, SecurityAlgorithms.RsaSha256),
            Claims = new Dictionary<string, object> { ["email"] = "push@local.test", ["email_verified"] = true },
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        var id = Guid.NewGuid().ToString();
        object payload = type == "test" ? new { packageName = package, testNotification = new { version = "1.0" } }
            : new { packageName = package, subscriptionNotification = new { notificationType = 2, purchaseToken = "local-token" } };
        var envelope = new { message = new { messageId = id, data = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(payload)) } };
        using var first = await client.PostAsJsonAsync("/webhooks/play", envelope, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        using var replay = await client.PostAsJsonAsync("/webhooks/play", envelope, TestContext.Current.CancellationToken);
        Assert.Equal(count == 1 ? HttpStatusCode.OK : HttpStatusCode.NoContent, replay.StatusCode);
        await using var db = fixture.CreateContext();
        var rows = await db.PlayNotifications.Where(x => x.MessageId == id).ToListAsync(TestContext.Current.CancellationToken);
        Assert.Equal(count, rows.Count);
        if (type == "test") Assert.NotNull(rows.Single().ProcessedAt);
        if (type == "normal" && count == 1) Assert.Null(rows.Single().ProcessedAt);
    }
    [Fact]
    public async Task SignedButOversizedOrMalformedBodiesAreRejectedWithoutStoring()
    {
        using var rsa = RSA.Create(2048); var key = new RsaSecurityKey(rsa) { KeyId = "local" };
        var jwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(new RsaSecurityKey(rsa.ExportParameters(false)) { KeyId = "local" });
        using var keys = new HttpClient(new KeysHandler(JsonSerializer.Serialize(new { keys = new[] { jwk } })));
        await using var factory = new PatikaApiFactory();
        factory.Settings["Billing:Rtdn:Audience"] = "local-push";
        factory.Settings["Billing:Rtdn:Email"] = "push@local.test";
        factory.ExtraServices = services =>
        {
            services.RemoveAll<PatikaDbContext>();
            services.AddScoped(_ => fixture.CreateContext());
            services.RemoveAll<PlayPushVerifier>();
            services.AddSingleton(sp => new PlayPushVerifier(keys, sp.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>(), TimeProvider.System));
        };
        using var client = factory.CreateClient();
        var now = DateTime.UtcNow;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", new JwtSecurityTokenHandler().CreateEncodedJwt(new SecurityTokenDescriptor
        {
            Issuer = "https://accounts.google.com",
            Audience = "local-push",
            IssuedAt = now,
            Expires = now.AddMinutes(5),
            SigningCredentials = new(key, SecurityAlgorithms.RsaSha256),
            Claims = new Dictionary<string, object> { ["email"] = "push@local.test", ["email_verified"] = true },
        }));
        await using var db = fixture.CreateContext();
        var before = await db.PlayNotifications.CountAsync(TestContext.Current.CancellationToken);

        // No Content-Length: the streamed cap has to stop it.
        using var chunked = new StreamContent(new MemoryStream(new byte[70_000]));
        using var oversized = await client.PostAsync("/webhooks/play", chunked, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, oversized.StatusCode);

        foreach (var body in new[] { "{}", "not json", """{"message":{"messageId":"m-1","data":"%%%"}}""", """{"message":{"messageId":"m-2","data":"e30="}}""" })
        {
            using var malformed = await client.PostAsync("/webhooks/play", new StringContent(body, System.Text.Encoding.UTF8, "application/json"), TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        }
        Assert.Equal(before, await db.PlayNotifications.CountAsync(TestContext.Current.CancellationToken));
    }

    private sealed class KeysHandler(string json) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
    }
}
