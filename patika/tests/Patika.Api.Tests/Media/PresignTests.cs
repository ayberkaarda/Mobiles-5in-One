using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Patika.Contracts.Media;
using Patika.Domain.Security;
using Xunit;

namespace Patika.Api.Tests.Media;

public sealed class PresignTests
{
    private const long FiveMegabytes = 5 * 1024 * 1024;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static Task<HttpResponseMessage> PresignAsync(HttpClient client, string kind, string contentType, long length) =>
        client.PostAsJsonAsync("/v1/uploads/presign", new PresignUploadRequest(kind, contentType, length), Ct);

    [Theory]
    [InlineData("image/svg+xml")]
    [InlineData("text/html")]
    [InlineData("image/gif")]
    [InlineData("image/heic")]
    [InlineData("application/octet-stream")]
    [InlineData("IMAGE/JPEG")]
    [InlineData("image/jpeg; charset=utf-8")]
    [InlineData("image/jpeg ")]
    [InlineData("")]
    public async Task SpoofedOrUnlistedContentTypesAreRejected(string contentType)
    {
        await using var host = await FeatureHost.StartAsync();
        var (_, client) = await host.SignInAsync();

        using var response = await PresignAsync(client, "station", contentType, 1000);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("contentType", await response.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
        Assert.Empty(host.Stores.Uploads.Reservations);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(FiveMegabytes + 1)]
    [InlineData(long.MaxValue)]
    public async Task EmptyAndOversizedUploadsAreRejected(long length)
    {
        await using var host = await FeatureHost.StartAsync();
        var (_, client) = await host.SignInAsync();

        using var response = await PresignAsync(client, "animal", "image/jpeg", length);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("contentLength", await response.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
        Assert.Empty(host.Stores.Uploads.Reservations);
    }

    [Theory]
    [InlineData("avatar")]
    [InlineData("Station")]
    [InlineData("../station")]
    public async Task UnknownKindsAreRejected(string kind)
    {
        await using var host = await FeatureHost.StartAsync();
        var (_, client) = await host.SignInAsync();

        using var response = await PresignAsync(client, kind, "image/png", 10);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("image/jpeg", 1)]
    [InlineData("image/png", 4096)]
    [InlineData("image/webp", FiveMegabytes)]
    public async Task AllowedUploadsGetAUrlThatSignsTypeAndLength(string contentType, long length)
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, client) = await host.SignInAsync();

        using var response = await PresignAsync(client, "feeding", contentType, length);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<PresignUploadResponse>(Ct))!;
        Assert.Equal("PUT", body.Method);
        Assert.True(MediaKeys.TryParse(body.Key, out var kind, out var uploadId));
        Assert.Equal(("feeding", body.UploadId), (kind, uploadId));
        var url = new Uri(body.UploadUrl);
        Assert.Equal("media.patika.test", url.Host);
        Assert.Equal("/patika-test/" + MediaKeys.Incoming(body.Key), url.AbsolutePath);
        var signedHeaders = Uri.UnescapeDataString(url.Query).Split('&').Single(p => p.StartsWith("X-Amz-SignedHeaders=", StringComparison.Ordinal));
        Assert.Contains("content-length", signedHeaders, StringComparison.Ordinal);
        Assert.Contains("content-type", signedHeaders, StringComparison.Ordinal);
        Assert.Equal(contentType, body.Headers["Content-Type"]);
        Assert.Equal(length.ToString(System.Globalization.CultureInfo.InvariantCulture), body.Headers["Content-Length"]);
        Assert.InRange(body.ExpiresAt - DateTimeOffset.UtcNow, TimeSpan.FromMinutes(4), TimeSpan.FromMinutes(5));
        var reservation = Assert.Single(host.Stores.Uploads.Reservations);
        Assert.Equal((userId, body.Key, contentType, length), (reservation.UserId, reservation.PhotoKey, reservation.ContentType, reservation.ContentLength));
    }

    [Fact]
    public async Task AnonymousCallersCannotPresign()
    {
        await using var host = await FeatureHost.StartAsync();

        using var response = await PresignAsync(host.Client, "station", "image/jpeg", 100);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task DailyQuotaIs30AndThe31stIsRefused()
    {
        await using var host = await FeatureHost.StartAsync();
        var (_, client) = await host.SignInAsync();
        var (_, other) = await host.SignInAsync();

        for (var i = 0; i < 30; i++)
        {
            using var ok = await PresignAsync(client, "station", "image/jpeg", 1000);
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
            Assert.Equal(29 - i, (await ok.Content.ReadFromJsonAsync<PresignUploadResponse>(Ct))!.RemainingToday);
        }

        using var refused = await PresignAsync(client, "station", "image/jpeg", 1000);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.True(refused.Headers.RetryAfter?.Delta > TimeSpan.Zero);
        using var problem = JsonDocument.Parse(await refused.Content.ReadAsStringAsync(Ct));
        Assert.Equal(MediaErrorCodes.QuotaExceeded, problem.RootElement.GetProperty("code").GetString());

        // The quota is per user.
        using var otherOk = await PresignAsync(other, "station", "image/jpeg", 1000);
        Assert.Equal(HttpStatusCode.OK, otherOk.StatusCode);
        Assert.Equal(31, host.Stores.Uploads.Reservations.Count);
    }

    [Fact]
    public async Task DestekciQuotaIs100()
    {
        await using var host = await FeatureHost.StartAsync();
        var (userId, client) = await host.SignInAsync(ActorRole.Trusted);
        host.Stores.Supporters.Supporters[userId] = true;

        for (var i = 0; i < 100; i++)
        {
            using var ok = await PresignAsync(client, "animal", "image/webp", 2048);
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }

        using var refused = await PresignAsync(client, "animal", "image/webp", 2048);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.Equal(100, host.Stores.Uploads.Reservations.Count);
    }
}
