using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Api.Tests.Infrastructure;
using Patika.Infrastructure.Billing;
using Xunit;

namespace Patika.SecurityTests.Subscriptions;

public sealed class EndpointBoundaryTests
{
    [Theory]
    [InlineData("Development", "Google")]
    [InlineData("Testing", "Fake")]
    [InlineData("Production", "Fake")]
    [InlineData("Production", "Google")]
    public async Task FakePurchaseEndpointIsAbsentOutsideDevelopmentFake(string environment, string provider)
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Billing:Provider"] = provider;
        factory.Settings["Billing:AllowFake"] = "true";
        factory.Settings["DataProtection:KeysPath"] = Path.Combine(Path.GetTempPath(), "patika-billing-tests");
        factory.Settings["Billing:PackageName"] = BillingTokens.Package;
        factory.Settings["Billing:Rtdn:Audience"] = "https://local.test/webhooks/play";
        factory.Settings["Billing:Rtdn:Email"] = "push@local.test";
        factory.Settings["Billing:Rtdn:JwksUrl"] = "https://local.test/keys";
        await using var configured = factory.WithWebHostBuilder(b => b.UseEnvironment(environment));
        using var client = configured.CreateClient();
        using var response = await client.PostAsJsonAsync("/dev/billing/purchases", new { basePlanId = "aylik" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
    [Theory]
    [InlineData("/v1/subscriptions/verify")]
    [InlineData("/dev/billing/purchases")]
    public async Task PurchasesRequireAuthentication(string path)
    {
        await using var factory = new PatikaApiFactory();
        await using var configured = factory.WithWebHostBuilder(b => b.UseEnvironment("Development"));
        using var client = configured.CreateClient();
        using var response = await client.PostAsJsonAsync(path, new { }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
    [Theory]
    [InlineData("Billing:Rtdn:Audience")]
    [InlineData("Billing:Rtdn:Email")]
    [InlineData("Billing:Rtdn:JwksUrl")]
    [InlineData("Billing:PackageName")]
    public void GoogleProviderRefusesToStartWithoutPushOrPackageSettings(string missing)
    {
        var settings = new Dictionary<string, string?>
        {
            ["Billing:Provider"] = "Google",
            ["Billing:PackageName"] = BillingTokens.Package,
            ["Billing:Rtdn:Audience"] = "https://local.test/webhooks/play",
            ["Billing:Rtdn:Email"] = "push@local.test",
            ["Billing:Rtdn:JwksUrl"] = "https://local.test/keys",
        };
        settings.Remove(missing);
        using var factory = new PatikaApiFactory();
        foreach (var (key, value) in settings) factory.Settings[key] = value;
        var error = Assert.ThrowsAny<Exception>(() => factory.CreateClient());
        Assert.Contains(missing, error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void OutboundBillingClientsHaveBoundedTimeouts()
    {
        using var factory = new PatikaApiFactory();
        using var push = factory.Services.GetRequiredService<IHttpClientFactory>().CreateClient("play-push");
        Assert.Equal(TimeSpan.FromSeconds(5), push.Timeout);
    }

    [Fact]
    public async Task UnsignedPushIsRejectedAndOversizedBodyIsCapped()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateClient();
        using var unsigned = await client.PostAsJsonAsync("/webhooks/play", new { }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unsigned.StatusCode);
        using var oversized = await client.PostAsync("/webhooks/play", new StringContent(new string('a', 65537)), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, oversized.StatusCode);
    }
}
