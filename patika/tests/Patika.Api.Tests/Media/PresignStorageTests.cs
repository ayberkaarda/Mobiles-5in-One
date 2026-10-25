using System.Net;
using System.Net.Http.Headers;
using Amazon.S3;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Microsoft.Extensions.Options;
using Patika.Api.Features.Media;
using Patika.Contracts.Media;
using Xunit;

namespace Patika.Api.Tests.Media;

/// <summary>MinIO (the compose image) on a random host port.</summary>
public sealed class PresignMinioFixture : IAsyncLifetime
{
    public const string Bucket = "patika-presign";
    public const string AccessKey = "patika-test-user";
    public const string SecretKey = "patika-test-storage-pass";

    private readonly IContainer container = new ContainerBuilder("pgsty/minio:RELEASE.2026-08-04T00-00-00Z")
        .WithCommand("server", "/data")
        .WithEnvironment("MINIO_ROOT_USER", AccessKey)
        .WithEnvironment("MINIO_ROOT_PASSWORD", SecretKey)
        .WithPortBinding(9000, assignRandomHostPort: true)
        .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(request => request
            .ForPort(9000).ForPath("/minio/health/live")))
        .Build();

    public string Endpoint => $"http://{container.Hostname}:{container.GetMappedPublicPort(9000)}";

    public async ValueTask InitializeAsync()
    {
        await container.StartAsync();
        using var client = Client();
        await client.PutBucketAsync(Bucket);
    }

    public AmazonS3Client Client() => new(AccessKey, SecretKey, new AmazonS3Config
    {
        ServiceURL = Endpoint,
        ForcePathStyle = true,
        AuthenticationRegion = "us-east-1",
        UseHttp = true,
    });

    public async ValueTask DisposeAsync() => await container.DisposeAsync();
}

/// <summary>The presigned URL itself enforces what was validated: storage refuses other lengths and types.</summary>
public sealed class PresignStorageTests(PresignMinioFixture minio) : IClassFixture<PresignMinioFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private S3UploadPresigner Presigner() => new(Options.Create(new StorageSettings
    {
        Endpoint = minio.Endpoint,
        Bucket = PresignMinioFixture.Bucket,
        AccessKey = PresignMinioFixture.AccessKey,
        SecretKey = PresignMinioFixture.SecretKey,
    }));

    private static async Task<HttpStatusCode> PutAsync(Uri url, byte[] body, string contentType)
    {
        using var http = new HttpClient();
        using var content = new ByteArrayContent(body);
        content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        using var response = await http.PutAsync(url, content, Ct);
        return response.StatusCode;
    }

    [Fact]
    public async Task SignedUrlAcceptsOnlyTheSignedLengthAndType()
    {
        using var presigner = Presigner();
        var body = new byte[4096];
        Random.Shared.NextBytes(body);
        body[0] = 0xFF;
        body[1] = 0xD8;
        body[2] = 0xFF;
        async Task<Uri> Sign(string key) =>
            await presigner.PresignPutAsync(MediaKeys.Incoming(key), "image/jpeg", body.Length, DateTimeOffset.UtcNow.AddMinutes(5));

        var longer = await Sign(MediaKeys.PhotoKey("station", Guid.CreateVersion7()));
        var shorter = await Sign(MediaKeys.PhotoKey("station", Guid.CreateVersion7()));
        var retyped = await Sign(MediaKeys.PhotoKey("station", Guid.CreateVersion7()));
        var exactKey = MediaKeys.PhotoKey("station", Guid.CreateVersion7());
        var exact = await Sign(exactKey);

        Assert.Equal(HttpStatusCode.Forbidden, await PutAsync(longer, [.. body, .. new byte[1024 * 1024]], "image/jpeg"));
        Assert.Equal(HttpStatusCode.Forbidden, await PutAsync(shorter, body[..100], "image/jpeg"));
        Assert.Equal(HttpStatusCode.Forbidden, await PutAsync(retyped, body, "image/svg+xml"));
        Assert.Equal(HttpStatusCode.OK, await PutAsync(exact, body, "image/jpeg"));

        using var client = minio.Client();
        var listed = await client.ListObjectsV2Async(new Amazon.S3.Model.ListObjectsV2Request { BucketName = PresignMinioFixture.Bucket }, Ct);
        var stored = Assert.Single(listed.S3Objects ?? []);
        Assert.Equal(MediaKeys.Incoming(exactKey), stored.Key);
        Assert.Equal(body.Length, stored.Size);
    }

    [Fact]
    public async Task ExpiredUrlsAreRefused()
    {
        using var presigner = Presigner();
        var url = await presigner.PresignPutAsync(
            MediaKeys.Incoming(MediaKeys.PhotoKey("urgent", Guid.CreateVersion7())), "image/png", 8, DateTimeOffset.UtcNow.AddSeconds(1));
        await Task.Delay(TimeSpan.FromSeconds(2.5), Ct);

        Assert.Equal(HttpStatusCode.Forbidden, await PutAsync(url, new byte[8], "image/png"));
    }
}
