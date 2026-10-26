using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Patika.Web.Services.Admin;
using Xunit;

namespace Patika.Web.Tests;

public sealed class NetworkHardeningTests
{
    [Theory]
    [InlineData("10.0.0.2", "192.0.2.1")]
    [InlineData("198.51.100.1", "198.51.100.1")]
    public async Task WebForwardsOnlyTheVerifiedClientToTheBff(string peer, string expected)
    {
        var capture = new Capture();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
            builder.UseSetting("Network:TrustedProxies:0", "10.0.0.2");
            builder.UseSetting("Network:BffSharedKey", "test-shared-secret");
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IStartupFilter>(new PeerAndEndpoint(peer));
                services.AddHttpClient("PatikaAdmin").ConfigurePrimaryHttpMessageHandler(() => capture);
            });
        });
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/network-test");
        request.Headers.Add("X-Forwarded-For", "192.0.2.1");
        request.Headers.Add("X-Patika-Client-Ip", "192.0.2.99");
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        Assert.Equal(expected, capture.Address);
        Assert.Equal("test-shared-secret", capture.Key);
    }

    [Fact]
    public async Task WebUsesTwoYearHstsPermissionsAndAStrictScriptPolicyThatKeepsPublicPagesCacheable()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://patika.test") });
        for (var i = 0; i < 2; i++)
        {
            using var response = await client.GetAsync("/sss", TestContext.Current.CancellationToken);
            response.EnsureSuccessStatusCode();
            Assert.Equal("max-age=63072000; includeSubDomains; preload", response.Headers.GetValues("Strict-Transport-Security").Single());
            Assert.Equal("geolocation=(self), camera=(), microphone=()", response.Headers.GetValues("Permissions-Policy").Single());
            var csp = response.Headers.GetValues("Content-Security-Policy").Single();
            Assert.Contains("script-src 'self';", csp, StringComparison.Ordinal);
            Assert.DoesNotContain("nonce-", csp, StringComparison.Ordinal);
            Assert.DoesNotContain("unsafe-inline", csp, StringComparison.Ordinal);
            var html = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            Assert.DoesNotContain("nonce=", html, StringComparison.Ordinal);
            Assert.Contains("<script type=\"application/ld+json\">", html, StringComparison.Ordinal);
            Assert.NotEqual(true, response.Headers.CacheControl?.NoStore);
            // The second request is answered by the output cache: one body serves every visitor.
            if (i == 1) Assert.NotNull(response.Headers.Age);
        }
    }

    private sealed class PeerAndEndpoint(string peer) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (context, continuation) =>
            {
                context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
                await continuation(context);
            });
            next(app);
            app.Run(async context =>
            {
                await context.RequestServices.GetRequiredService<AdminApi>().GetAsync<object>("/network-test", context.RequestAborted);
                await context.Response.WriteAsync("ok");
            });
        };
    }

    private sealed class Capture : HttpMessageHandler
    {
        public string? Address { get; private set; }
        public string? Key { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Address = request.Headers.GetValues("X-Patika-Client-Ip").Single();
            Key = request.Headers.GetValues("X-Patika-Bff-Key").Single();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json") });
        }
    }
}
