using System.Net;
using System.Web;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using Patika.Contracts.Media;
using Patika.Infrastructure.Media;
using Xunit;

namespace Patika.Api.Tests.Media;

/// <summary>Photo keys become addresses of processed renditions only, signed and short-lived by default.</summary>
public sealed class PhotoUrlResolverTests
{
    private static readonly StorageSettings Storage = new()
    {
        Endpoint = "http://minio:9000",
        PublicEndpoint = "https://media.patika.test",
        Bucket = "patika-test",
        AccessKey = "test-access",
        SecretKey = "test-secret-value",
    };

    [Fact]
    public void SignedUrlPointsAtTheMediaRenditionAndExpiresInFifteenMinutes()
    {
        using var resolver = Resolver(Storage);
        var key = MediaKeys.PhotoKey("station", Guid.CreateVersion7());

        var url = new Uri(resolver.Resolve(key)!);

        Assert.Equal("https", url.Scheme);
        Assert.Equal("media.patika.test", url.Host);
        Assert.Equal($"/patika-test/media/{key}.webp", url.AbsolutePath);
        var query = HttpUtility.ParseQueryString(url.Query);
        Assert.Equal("900", query["X-Amz-Expires"]);
        Assert.NotNull(query["X-Amz-Signature"]);
        Assert.Equal(15, new MediaSettings().PhotoUrlMinutes);
    }

    [Theory]
    [InlineData(PhotoSize.Full, ".webp")]
    [InlineData(PhotoSize.Medium, "_800.webp")]
    [InlineData(PhotoSize.Thumbnail, "_320.webp")]
    public void SizesMapToTheWorkerRenditions(PhotoSize size, string suffix)
    {
        using var resolver = Resolver(WithBase("https://cdn.patika.test/"));
        var key = MediaKeys.PhotoKey("animal", Guid.CreateVersion7());

        Assert.Equal($"https://cdn.patika.test/media/{key}{suffix}", resolver.Resolve(key, size));
    }

    [Fact]
    public void PublicBaseUrlGivesAStableUnsignedAddress()
    {
        using var resolver = Resolver(WithBase("https://cdn.patika.test/foto"));
        var key = MediaKeys.PhotoKey("feeding", Guid.CreateVersion7());

        var first = resolver.Resolve(key);
        Assert.Equal(first, resolver.Resolve(key));
        Assert.Equal($"https://cdn.patika.test/foto/media/{key}.webp", first);
        Assert.DoesNotContain("X-Amz", first, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("incoming/station/0199f0a0-0000-7000-8000-000000000001")]
    [InlineData("quarantine/station/0199f0a0-0000-7000-8000-000000000001")]
    [InlineData("media/station/0199f0a0-0000-7000-8000-000000000001")]
    [InlineData("station/../incoming/0199f0a0-0000-7000-8000-000000000001")]
    [InlineData("station/0199F0A0-0000-7000-8000-000000000001")]
    [InlineData("avatar/0199f0a0-0000-7000-8000-000000000001")]
    [InlineData("station/0199f0a0-0000-7000-8000-000000000001/../../quarantine")]
    [InlineData("https://evil.example/x.webp")]
    public void AnythingButAPlainPhotoKeyResolvesToNull(string? key)
    {
        using var signed = Resolver(Storage);
        using var cdn = Resolver(WithBase("https://cdn.patika.test"));

        Assert.Null(signed.Resolve(key));
        Assert.Null(cdn.Resolve(key));
    }

    [Fact]
    public void NoResolvedAddressEverNamesIncomingOrQuarantine()
    {
        using var signed = Resolver(Storage);
        using var cdn = Resolver(WithBase("https://cdn.patika.test"));
        foreach (var kind in MediaKeys.Kinds)
        {
            foreach (var size in Enum.GetValues<PhotoSize>())
            {
                var key = MediaKeys.PhotoKey(kind, Guid.CreateVersion7());
                foreach (var url in new[] { signed.Resolve(key, size)!, cdn.Resolve(key, size)! })
                {
                    var path = new Uri(url).AbsolutePath;
                    Assert.Contains("/media/", path, StringComparison.Ordinal);
                    Assert.DoesNotContain(MediaKeys.IncomingPrefix, url, StringComparison.Ordinal);
                    Assert.DoesNotContain(MediaKeys.QuarantinePrefix, url, StringComparison.Ordinal);
                }
            }
        }
    }

    [Fact]
    public void WithoutStorageEveryKeyResolvesToNull()
    {
        using var resolver = Resolver(new StorageSettings());
        Assert.Null(resolver.Resolve(MediaKeys.PhotoKey("urgent", Guid.CreateVersion7())));
    }

    [Fact]
    public void NonHttpPublicBaseUrlIsRefused() =>
        Assert.Throws<InvalidOperationException>(() => Resolver(WithBase("ftp://cdn.patika.test")));

    [Fact]
    public void TheRegisteredResolverHonoursTheConfiguredLifetime()
    {
        using var resolver = new PhotoUrlResolver(Options.Create(Storage), Options.Create(new MediaSettings { PhotoUrlMinutes = 5 }),
            TimeProvider.System);

        var query = HttpUtility.ParseQueryString(new Uri(resolver.Resolve(MediaKeys.PhotoKey("station", Guid.CreateVersion7()))!).Query);
        Assert.Equal("300", query["X-Amz-Expires"]);
    }

    private static StorageSettings WithBase(string publicBaseUrl) => new()
    {
        Endpoint = Storage.Endpoint,
        PublicEndpoint = Storage.PublicEndpoint,
        Bucket = Storage.Bucket,
        AccessKey = Storage.AccessKey,
        SecretKey = Storage.SecretKey,
        PublicBaseUrl = publicBaseUrl,
    };

    private static PhotoUrlResolver Resolver(StorageSettings settings) =>
        new(Options.Create(settings), Options.Create(new MediaSettings()), TimeProvider.System);
}

/// <summary>Against MinIO: the signed GET serves the rendition, then stops working once it expires.</summary>
public sealed class PhotoUrlStorageTests(PresignMinioFixture minio) : IClassFixture<PresignMinioFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task SignedGetWorksUntilItExpires()
    {
        var key = MediaKeys.PhotoKey("station", Guid.CreateVersion7());
        using (var client = minio.Client())
        {
            await client.PutObjectAsync(new PutObjectRequest
            {
                BucketName = PresignMinioFixture.Bucket,
                Key = MediaKeys.Rendition(key, null),
                ContentBody = "webp-bytes",
                ContentType = "image/webp",
            }, Ct);
            await client.PutObjectAsync(new PutObjectRequest
            {
                BucketName = PresignMinioFixture.Bucket,
                Key = MediaKeys.Incoming(key),
                ContentBody = "raw-bytes",
            }, Ct);
        }

        using var resolver = new PhotoUrlResolver(new StorageSettings
        {
            Endpoint = minio.Endpoint,
            Bucket = PresignMinioFixture.Bucket,
            AccessKey = PresignMinioFixture.AccessKey,
            SecretKey = PresignMinioFixture.SecretKey,
        }, TimeSpan.FromSeconds(2), TimeProvider.System);
        var url = resolver.Resolve(key)!;
        using var http = new HttpClient();

        using (var fresh = await http.GetAsync(url, Ct))
        {
            Assert.Equal(HttpStatusCode.OK, fresh.StatusCode);
            Assert.Equal("webp-bytes", await fresh.Content.ReadAsStringAsync(Ct));
        }

        // The signature covers the object key: pointing the same URL at incoming/ is refused.
        var tampered = url.Replace("/media/", "/incoming/", StringComparison.Ordinal).Replace(".webp?", "?", StringComparison.Ordinal);
        using (var forged = await http.GetAsync(tampered, Ct))
        {
            Assert.Equal(HttpStatusCode.Forbidden, forged.StatusCode);
        }

        await Task.Delay(TimeSpan.FromSeconds(4), Ct);
        using var expired = await http.GetAsync(url, Ct);
        Assert.Equal(HttpStatusCode.Forbidden, expired.StatusCode);
    }
}
