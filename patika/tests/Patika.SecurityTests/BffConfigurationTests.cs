using System.Net.Http.Json;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Dto;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.SecurityTests;

public sealed class BffConfigurationTests
{
    private const string Bff = "10.20.30.40";
    private const string Key = "shared-test-key-for-the-bff-configuration";

    [Theory]
    [InlineData("web", Key, "not a host name")]
    [InlineData("10", Key, "not a host name")]
    [InlineData(Bff, "too-short-key", "at least 32 characters")]
    [InlineData(Bff, null, "must be set together")]
    [InlineData(null, Key, "must be set together")]
    public async Task AMisconfiguredBffStopsTheApiAtStartup(string? address, string? key, string expected)
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Network:BffAddress"] = address;
        factory.Settings["Network:BffSharedKey"] = key;

        var error = Assert.Throws<InvalidOperationException>(() => factory.CreateApiClient());

        Assert.Contains(expected, error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(Key, error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(Bff, Bff, Key, true)]
    [InlineData(Bff, "::ffff:10.20.30.40", Key, true)]
    [InlineData("::ffff:10.20.30.40", Bff, Key, true)]
    [InlineData("2001:db8::10", "2001:db8::10", Key, true)]
    [InlineData(Bff, "198.51.100.9", Key, false)]
    [InlineData(Bff, Bff, "wrong-key-of-the-same-length-as-the-real-one", false)]
    [InlineData(Bff, Bff, null, false)]
    public async Task TheHealthCheckEchoesOnlyWhetherTheClaimWasAccepted(string configured, string peer, string? key, bool accepted)
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Network:BffAddress"] = configured;
        factory.Settings["Network:BffSharedKey"] = Key;
        using var client = factory.CreateApiClient(peer: peer);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/v1/health/bff");
        request.Headers.Add("X-Patika-Client-Ip", "192.0.2.1");
        if (key is not null) request.Headers.Add("X-Patika-Bff-Key", key);

        using var response = await client.SendAsync(request, Ct);

        response.EnsureSuccessStatusCode();
        var raw = await response.Content.ReadAsStringAsync(Ct);
        Assert.Equal(accepted, (await response.Content.ReadFromJsonAsync<BffCheckResponse>(Ct))!.BffClaimAccepted);
        Assert.DoesNotContain(Key, raw, StringComparison.Ordinal);
        Assert.DoesNotContain("192.0.2.1", raw, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AValidKeyFromTheWrongPeerIsIgnoredWithAWarningThatNamesThePeerButNotTheKey()
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["Network:BffAddress"] = Bff;
        factory.Settings["Network:BffSharedKey"] = Key;
        using var client = factory.CreateApiClient(peer: "198.51.100.9");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/v1/health/bff");
        request.Headers.Add("X-Patika-Client-Ip", "192.0.2.1");
        request.Headers.Add("X-Patika-Bff-Key", Key);

        using var response = await client.SendAsync(request, Ct);

        Assert.False((await response.Content.ReadFromJsonAsync<BffCheckResponse>(Ct))!.BffClaimAccepted);
        var logs = string.Join('\n', factory.Logs.RenderAll());
        Assert.Contains("A valid BFF key arrived from", logs, StringComparison.Ordinal);
        Assert.Contains("\"Peer\":\"198.51.100.9\"", logs, StringComparison.Ordinal);
        Assert.Contains("\"BffAddress\":\"10.20.30.40\"", logs, StringComparison.Ordinal);
        Assert.DoesNotContain(Key, logs, StringComparison.Ordinal);
    }
}
