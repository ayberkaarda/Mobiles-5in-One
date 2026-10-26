using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Patika.Web.Services.Admin;
using Serilog.Core;
using Serilog.Events;
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
            builder.UseSetting("Network:BffSharedKey", "test-shared-secret-for-the-network-tests");
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
        var sent = Assert.Single(capture.Requests, r => r.Path == "/v1/network-test");
        Assert.Equal(expected, sent.Address);
        Assert.Equal("test-shared-secret-for-the-network-tests", sent.Key);
    }

    [Fact]
    public async Task TwoAdminsRefreshingAreForwardedWithTheirOwnAddresses()
    {
        var capture = new Capture();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
            builder.UseSetting("Network:BffSharedKey", "test-shared-secret-for-the-network-tests");
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IStartupFilter>(new PeerFromHeaderAndRefresh());
                services.AddHttpClient("PatikaAdmin").ConfigurePrimaryHttpMessageHandler(() => capture);
            });
        });
        using var client = factory.CreateClient();
        foreach (var (peer, token) in new[] { ("198.51.100.21", "refresh-a"), ("198.51.100.22", "refresh-b") })
        {
            // A path per admin: the output cache must not answer the second request.
            using var request = new HttpRequestMessage(HttpMethod.Get, "/refresh-test/" + token);
            request.Headers.Add("X-Test-Peer", peer);
            request.Headers.Add("X-Test-Refresh", token);
            using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
            response.EnsureSuccessStatusCode();
        }

        var refreshes = capture.Requests.Where(r => r.Path == "/v1/auth/refresh").ToList();
        Assert.Equal(["198.51.100.21", "198.51.100.22"], refreshes.Select(r => r.Address));
        Assert.All(refreshes, r => Assert.Equal("test-shared-secret-for-the-network-tests", r.Key));
    }

    [Fact]
    public async Task AShortBffKeyStopsTheWebAtStartup()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
            builder.UseSetting("Network:BffSharedKey", "too-short");
        });
        var error = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains("at least 32 characters", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task TheSelfCheckReportsWhetherTheApiAcceptedTheClaim(bool accepted)
    {
        var capture = new Capture { BffAccepted = accepted };
        var logs = new ListSink();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:PatikaRead", "Host=localhost;Port=1;Database=unused");
            builder.UseSetting("Network:BffSharedKey", "test-shared-secret-for-the-network-tests");
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<ILogEventSink>(logs);
                services.AddHttpClient("PatikaAdmin").ConfigurePrimaryHttpMessageHandler(() => capture);
            });
        });

        var result = await factory.Services.GetRequiredService<BffSelfCheck>().CheckAsync(TestContext.Current.CancellationToken);

        Assert.Equal(accepted, result);
        var probe = capture.Requests.First(r => r.Path == "/v1/health/bff");
        Assert.Equal(BffSelfCheck.ProbeAddress, probe.Address);
        Assert.Equal(accepted, logs.Messages.Any(m => m.Contains("bff.check: the API accepts", StringComparison.Ordinal)));
        Assert.Equal(!accepted, logs.Messages.Any(m => m.Contains("bff.check: the API ignored", StringComparison.Ordinal)));
        Assert.DoesNotContain(logs.Messages, m => m.Contains("test-shared-secret", StringComparison.Ordinal));
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

    /// <summary>Applies the peer from a test header and answers by running a cookie refresh for the given token.</summary>
    private sealed class PeerFromHeaderAndRefresh : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (context, continuation) =>
            {
                if (context.Request.Headers["X-Test-Peer"].ToString() is { Length: > 0 } peer)
                    context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
                await continuation(context);
            });
            next(app);
            app.Run(async context =>
            {
                await context.RequestServices.GetRequiredService<AdminRefresh>()
                    .RefreshAsync(context.Request.Headers["X-Test-Refresh"].ToString(), context.RequestAborted);
                await context.Response.WriteAsync("ok");
            });
        };
    }

    private sealed class Capture : HttpMessageHandler
    {
        private readonly System.Collections.Concurrent.ConcurrentQueue<(string Path, string? Address, string? Key)> requests = new();

        public bool BffAccepted { get; init; } = true;

        public IReadOnlyList<(string Path, string? Address, string? Key)> Requests => [.. requests];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            requests.Enqueue((path,
                request.Headers.TryGetValues("X-Patika-Client-Ip", out var address) ? address.Single() : null,
                request.Headers.TryGetValues("X-Patika-Bff-Key", out var key) ? key.Single() : null));
            var body = path switch
            {
                "/v1/auth/refresh" => """{"accessToken":"a","tokenType":"Bearer","expiresIn":900,"refreshToken":"r","refreshExpiresIn":3600}""",
                "/v1/health/bff" => BffAccepted ? """{"bffClaimAccepted":true}""" : """{"bffClaimAccepted":false}""",
                _ => "{}",
            };
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") });
        }
    }

    private sealed class ListSink : ILogEventSink
    {
        private readonly System.Collections.Concurrent.ConcurrentQueue<string> messages = new();

        public IReadOnlyList<string> Messages => [.. messages];

        public void Emit(LogEvent logEvent) => messages.Enqueue(logEvent.RenderMessage(System.Globalization.CultureInfo.InvariantCulture));
    }
}
