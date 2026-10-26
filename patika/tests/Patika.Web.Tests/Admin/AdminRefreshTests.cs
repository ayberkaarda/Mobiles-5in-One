using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Caching.Memory;
using Patika.Contracts.Auth;
using Patika.Web.Services.Admin;
using Xunit;

namespace Patika.Web.Tests.Admin;

public sealed class AdminRefreshTests
{
    [Fact]
    public async Task ConcurrentTicketsShareOneRotationAndFailuresAreNotCached()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions());
        using var handler = new RotationHandler();
        using var refresh = new AdminRefresh(new Clients(handler), cache);
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => refresh.RefreshAsync("old-refresh", TestContext.Current.CancellationToken)));
        Assert.Equal(1, handler.Calls);
        Assert.All(results, result => Assert.Equal("rotated-refresh", result.RefreshToken));
        handler.Refuse = true;
        await Assert.ThrowsAsync<AdminApiException>(() => refresh.RefreshAsync("different-refresh", TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<AdminApiException>(() => refresh.RefreshAsync("different-refresh", TestContext.Current.CancellationToken));
        Assert.Equal(3, handler.Calls);
    }

    private sealed class Clients(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false) { BaseAddress = new Uri("https://api.test/") };
    }

    private sealed class RotationHandler : HttpMessageHandler
    {
        public int Calls;
        public bool Refuse;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Calls);
            Assert.Equal("/v1/auth/refresh", request.RequestUri!.AbsolutePath);
            return Task.FromResult(Refuse ? new HttpResponseMessage(HttpStatusCode.Unauthorized) : new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new TokenResponse("rotated-access", "Bearer", 900, "rotated-refresh", 3600))
            });
        }
    }
}
