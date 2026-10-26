using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Patika.Contracts.Auth;

namespace Patika.Web.Services.Admin;

public sealed class AdminRefresh(IHttpClientFactory clients, IMemoryCache cache) : IDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<TokenResponse> RefreshAsync(string refreshToken, CancellationToken ct)
    {
        var key = "admin-refresh:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken)));
        await gate.WaitAsync(ct);
        try
        {
            // Parallel requests carrying the previous ticket must share one refresh rotation.
            if (cache.TryGetValue<TokenResponse>(key, out var rotated) && rotated is not null) return rotated;
            using var client = clients.CreateClient("PatikaAdmin");
            using var response = await client.PostAsJsonAsync("v1/auth/refresh", new RefreshRequest(refreshToken), ct);
            if (!response.IsSuccessStatusCode) throw new AdminApiException((int)response.StatusCode, "refresh_invalid");
            var tokens = await response.Content.ReadFromJsonAsync<TokenResponse>(ct) ?? throw new AdminApiException(401, "refresh_invalid");
            cache.Set(key, tokens, TimeSpan.FromSeconds(60));
            return tokens;
        }
        finally { gate.Release(); }
    }

    public void Dispose() => gate.Dispose();
}
