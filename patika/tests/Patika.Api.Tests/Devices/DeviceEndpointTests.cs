using System.Net;
using System.Net.Http.Json;
using Patika.Api.Tests.Media;
using Patika.Contracts.Geo;
using Patika.Contracts.Urgent;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Api.Tests.Devices;

public sealed class DeviceEndpointTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static string FcmToken() => "dK3s9:APA91b" + Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");

    private static Task<HttpResponseMessage> UnregisterAsync(HttpClient client, string token) =>
        client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/v1/me/device-token")
        {
            Content = JsonContent.Create(new UnregisterDeviceRequest(token)),
        }, Ct);

    [Fact]
    public async Task RegisterAndUnregisterOnlyTouchTheCallersTokens()
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, client) = await host.SignInAsync();
        var (otherId, other) = await host.SignInAsync();
        var token = FcmToken();
        var othersToken = FcmToken();

        using var registered = await client.PutAsJsonAsync("/v1/me/device-token", new RegisterDeviceRequest(token, Guid.NewGuid(), null), Ct);
        using var sandbox = await other.PutAsJsonAsync("/v1/me/device-token", new RegisterDeviceRequest(othersToken, Guid.NewGuid(), "Sandbox"), Ct);
        using var foreignDelete = await UnregisterAsync(client, othersToken);
        using var ownDelete = await UnregisterAsync(client, token);

        Assert.Equal(HttpStatusCode.NoContent, registered.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, sandbox.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, foreignDelete.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, ownDelete.StatusCode);
        Assert.False(host.Stores.Devices.Tokens.ContainsKey(token));
        Assert.Equal((otherId, StoreEnvironment.Sandbox), (host.Stores.Devices.Tokens[othersToken].UserId, host.Stores.Devices.Tokens[othersToken].Environment));
        Assert.NotEqual(userId, otherId);
    }

    [Fact]
    public async Task KnowingAnotherInstallationsTokenDoesNotLetYouTakeItOver()
    {
        await using var host = await FeatureHost.StartAsync();
        var (victimId, victim) = await host.SignInAsync();
        var (attackerId, attacker) = await host.SignInAsync();
        var (newOwnerId, newOwner) = await host.SignInAsync();
        var token = FcmToken();
        var installation = Guid.NewGuid();
        using var own = await victim.PutAsJsonAsync("/v1/me/device-token", new RegisterDeviceRequest(token, installation, null), Ct);

        using var hijack = await attacker.PutAsJsonAsync("/v1/me/device-token", new RegisterDeviceRequest(token, Guid.NewGuid(), null), Ct);

        Assert.Equal(HttpStatusCode.NoContent, own.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, hijack.StatusCode);
        using (var problem = System.Text.Json.JsonDocument.Parse(await hijack.Content.ReadAsStringAsync(Ct)))
        {
            Assert.Equal(UrgentErrorCodes.DeviceTokenInUse, problem.RootElement.GetProperty("code").GetString());
        }

        Assert.Equal(victimId, host.Stores.Devices.Tokens[token].UserId);
        Assert.NotEqual(victimId, attackerId);

        // The same installation (a different account signing in on that phone) may move it.
        using var moved = await newOwner.PutAsJsonAsync("/v1/me/device-token", new RegisterDeviceRequest(token, installation, null), Ct);
        Assert.Equal(HttpStatusCode.NoContent, moved.StatusCode);
        Assert.Equal(newOwnerId, host.Stores.Devices.Tokens[token].UserId);
    }

    [Fact]
    public async Task InstallationIdIsRequired()
    {
        await using var host = await FeatureHost.StartAsync();
        var (_, client) = await host.SignInAsync();

        using var response = await client.PutAsJsonAsync("/v1/me/device-token", new RegisterDeviceRequest(FcmToken(), Guid.Empty, null), Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(host.Stores.Devices.Tokens);
    }

    [Theory]
    [InlineData("short")]
    [InlineData("token with spaces and enough length to pass the minimum")]
    [InlineData("<script>alert(1)</script>-padding-padding-padding")]
    public async Task MalformedTokensAreRejected(string token)
    {
        await using var host = await FeatureHost.StartAsync();
        var (_, client) = await host.SignInAsync();

        using var response = await client.PutAsJsonAsync("/v1/me/device-token", new RegisterDeviceRequest(token, Guid.NewGuid(), null), Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(host.Stores.Devices.Tokens);
    }

    [Fact]
    public async Task AnonymousCallersCannotRegister()
    {
        await using var host = await FeatureHost.StartAsync();

        using var response = await host.Client.PutAsJsonAsync("/v1/me/device-token", new RegisterDeviceRequest(FcmToken(), Guid.NewGuid(), null), Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task OptInNeedsAHomeAreaAndStoresItRoundedToThreeDecimals()
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, client) = await host.SignInAsync();

        using var missing = await client.PutAsJsonAsync("/v1/me/urgent-settings", new UrgentSettingsRequest(true, null, null), Ct);
        using var abroad = await client.PutAsJsonAsync("/v1/me/urgent-settings",
            new UrgentSettingsRequest(true, new CoordinateDto(52.52, 13.405), null), Ct);
        using var tooWide = await client.PutAsJsonAsync("/v1/me/urgent-settings",
            new UrgentSettingsRequest(true, new CoordinateDto(41.0, 29.0), 5000), Ct);
        using var saved = await client.PutAsJsonAsync("/v1/me/urgent-settings",
            new UrgentSettingsRequest(true, new CoordinateDto(41.008237, 28.978358), 1500), Ct);

        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, abroad.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooWide.StatusCode);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var body = (await saved.Content.ReadFromJsonAsync<UrgentSettingsResponse>(Ct))!;
        Assert.Equal(new CoordinateDto(41.008, 28.978), body.HomeArea);
        Assert.Equal(1500, body.RadiusMeters);
        var stored = host.Stores.Devices.Settings[userId];
        Assert.Equal((41.008, 28.978), (stored.HomeArea!.Value.Latitude, stored.HomeArea.Value.Longitude));
    }

    [Fact]
    public async Task OptingOutErasesTheSavedArea()
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, client) = await host.SignInAsync();
        using var optIn = await client.PutAsJsonAsync("/v1/me/urgent-settings",
            new UrgentSettingsRequest(true, new CoordinateDto(39.9208, 32.8541), null), Ct);

        using var optOut = await client.PutAsJsonAsync("/v1/me/urgent-settings",
            new UrgentSettingsRequest(false, new CoordinateDto(39.9208, 32.8541), null), Ct);
        var read = await client.GetFromJsonAsync<UrgentSettingsResponse>("/v1/me/urgent-settings", Ct);

        Assert.Equal(HttpStatusCode.OK, optIn.StatusCode);
        Assert.Equal(HttpStatusCode.OK, optOut.StatusCode);
        Assert.Equal(new UrgentSettingsResponse(false, null, 2000), read);
        Assert.Null(host.Stores.Devices.Settings[userId].HomeArea);
    }
}
