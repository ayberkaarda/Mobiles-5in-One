using System.Net;
using System.Text.Json;
using Patika.App.Core.Api;
using Patika.App.Core.Media;
using Patika.Contracts.Media;
using Xunit;

namespace Patika.App.Tests.Media;

public sealed class PhotoUploaderTests
{
    private const string UserId = "4f1c2b8e-0000-4000-8000-0000000000bb";
    private const string UploadUrl = "https://storage.test/patika/incoming/station/0199f000-0000-7000-8000-000000000001?X-Amz-Signature=abc";

    private readonly ManualClock clock = new();
    private readonly List<RecordedRequest> api = [];
    private readonly List<StoragePut> puts = [];
    private Func<PresignUploadRequest, PresignUploadResponse>? presign;
    private HttpStatusCode putStatus = HttpStatusCode.OK;
    private string presignedUrl = UploadUrl;
    private StorageOrigins origins = new(["https://storage.test"]);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private sealed record StoragePut(HttpMethod Method, Uri Url, string? ContentType, long? ContentLength,
        string? Authorization, byte[] Body);

    private PhotoUploader Uploader()
    {
        var tokens = new TokenManager(new MemoryTokenStore { Session = new StoredSession("refresh-0", UserId) }, clock);
        var handler = new FakeHandler(request =>
        {
            api.Add(request);
            if (request.Path == "/v1/auth/refresh")
            {
                return Http.Done(Http.Json(HttpStatusCode.OK, Http.Tokens(UserId, "1")));
            }

            var body = JsonSerializer.Deserialize<PresignUploadRequest>(request.Body!, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
            var answer = presign?.Invoke(body) ?? new PresignUploadResponse(Guid.Parse("0199f000-0000-7000-8000-000000000001"),
                "station/0199f000-0000-7000-8000-000000000001", "PUT", presignedUrl,
                new Dictionary<string, string> { ["Content-Type"] = body.ContentType, ["Content-Length"] = body.ContentLength.ToString(System.Globalization.CultureInfo.InvariantCulture) },
                clock.GetUtcNow().AddMinutes(10), 19);
            return Http.Done(Http.Json(HttpStatusCode.OK, answer));
        });
        var client = new PatikaApiClient(new HttpClient(handler), tokens, new ApiOptions { BaseAddress = new Uri("http://api.test/") });
        var storage = new HttpClient(new StorageHandler(this));
        return new PhotoUploader(client, new PhotoPipeline(new PassThroughTranscoder()), storage, origins);
    }

    private sealed class StorageHandler(PhotoUploaderTests owner) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            owner.puts.Add(new StoragePut(request.Method, request.RequestUri!, request.Content?.Headers.ContentType?.ToString(),
                request.Content?.Headers.ContentLength, request.Headers.Authorization?.ToString(),
                request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken)));
            return new HttpResponseMessage(owner.putStatus);
        }
    }

    private static PickedPhoto Picked(byte[] bytes) => new("a.jpg", "image/jpeg", _ => Task.FromResult<Stream>(new MemoryStream(bytes)));

    [Fact]
    public async Task Presigns_with_the_exact_type_and_length_then_puts_the_clean_bytes_without_the_api_token()
    {
        var uploader = Uploader();
        var photo = await uploader.PrepareAsync(Picked(TestJpegs.WithGpsExif(TestJpegs.Plain(48, 32))), Ct);

        var key = await uploader.UploadAsync(photo, "station", Ct);

        Assert.Equal("station/0199f000-0000-7000-8000-000000000001", key);
        var request = Assert.Single(api, r => r.Path == "/v1/uploads/presign");
        Assert.NotNull(request.Bearer);
        Assert.NotNull(request.IdempotencyKey);
        using (var body = JsonDocument.Parse(request.Body!))
        {
            Assert.Equal("station", body.RootElement.GetProperty("kind").GetString());
            Assert.Equal("image/jpeg", body.RootElement.GetProperty("contentType").GetString());
            Assert.Equal(photo.Length, body.RootElement.GetProperty("contentLength").GetInt64());
        }

        var put = Assert.Single(puts);
        Assert.Equal(HttpMethod.Put, put.Method);
        Assert.Equal(UploadUrl, put.Url.AbsoluteUri);
        Assert.Equal("image/jpeg", put.ContentType);
        Assert.Equal(photo.Length, put.ContentLength);
        Assert.Null(put.Authorization);
        Assert.Equal(photo.Jpeg, put.Body);
        Assert.False(TestJpegs.Contains(put.Body, "Exif"));
        Assert.False(TestJpegs.Contains(put.Body, TestJpegs.GpsSentinel));
    }

    [Theory]
    [InlineData("POST", "image/jpeg", 0)]
    [InlineData("PUT", "image/png", 0)]
    [InlineData("PUT", "image/jpeg", 1)]
    public async Task A_presign_that_does_not_match_the_upload_is_refused_before_any_byte_leaves(string method, string type, long extra)
    {
        presign = body => new PresignUploadResponse(Guid.NewGuid(), "station/0199f000-0000-7000-8000-000000000001", method, UploadUrl,
            new Dictionary<string, string> { ["Content-Type"] = type, ["Content-Length"] = (body.ContentLength + extra).ToString(System.Globalization.CultureInfo.InvariantCulture) },
            clock.GetUtcNow().AddMinutes(10), 1);
        var uploader = Uploader();
        var photo = await uploader.PrepareAsync(Picked(TestJpegs.Plain(16, 16)), Ct);

        var e = await Assert.ThrowsAsync<ApiException>(() => uploader.UploadAsync(photo, "station", Ct));

        Assert.Equal(UploadErrors.BadPresignCode, e.Code);
        Assert.Empty(puts);
    }

    [Fact]
    public async Task A_key_for_another_kind_is_refused()
    {
        presign = body => new PresignUploadResponse(Guid.NewGuid(), "urgent/0199f000-0000-7000-8000-000000000001", "PUT", UploadUrl,
            new Dictionary<string, string> { ["Content-Type"] = body.ContentType, ["Content-Length"] = body.ContentLength.ToString(System.Globalization.CultureInfo.InvariantCulture) },
            clock.GetUtcNow().AddMinutes(10), 1);
        var uploader = Uploader();
        var photo = await uploader.PrepareAsync(Picked(TestJpegs.Plain(16, 16)), Ct);

        await Assert.ThrowsAsync<ApiException>(() => uploader.UploadAsync(photo, "station", Ct));
        Assert.Empty(puts);
    }

    [Fact]
    public async Task A_refused_put_surfaces_as_a_turkish_error()
    {
        putStatus = HttpStatusCode.Forbidden;
        var uploader = Uploader();
        var photo = await uploader.PrepareAsync(Picked(TestJpegs.Plain(16, 16)), Ct);

        var e = await Assert.ThrowsAsync<ApiException>(() => uploader.UploadAsync(photo, "station", Ct));

        Assert.Equal(UploadErrors.PutFailedCode, e.Code);
        Assert.Equal(UploadErrors.PutFailedText, e.Message);
        Assert.Equal(403, e.Status);
    }

    [Fact]
    public async Task An_unknown_kind_never_reaches_the_api()
    {
        var uploader = Uploader();
        var photo = await uploader.PrepareAsync(Picked(TestJpegs.Plain(16, 16)), Ct);

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => uploader.UploadAsync(photo, "avatar", Ct));
        Assert.DoesNotContain(api, r => r.Path == "/v1/uploads/presign");
    }

    [Theory]
    [InlineData("https://evil.test/patika/incoming/x?sig=1")]
    [InlineData("https://storage.test:8443/patika/incoming/x?sig=1")]
    [InlineData("http://storage.test/patika/incoming/x?sig=1")]
    [InlineData("http://192.168.1.10:9000/patika/incoming/x?sig=1")]
    [InlineData("http://10.0.2.2:9000/patika/incoming/x?sig=1")]
    [InlineData("https://user:pass@storage.test/patika/incoming/x?sig=1")]
    public async Task A_presigned_address_outside_the_configured_storage_origin_is_never_contacted(string url)
    {
        presignedUrl = url;
        var uploader = Uploader();
        var photo = await uploader.PrepareAsync(Picked(TestJpegs.Plain(16, 16)), Ct);

        var e = await Assert.ThrowsAsync<ApiException>(() => uploader.UploadAsync(photo, "station", Ct));

        Assert.Equal(UploadErrors.BadPresignCode, e.Code);
        Assert.Empty(puts);
    }

    [Fact]
    public async Task Cleartext_is_allowed_only_for_the_debug_hosts_and_only_on_a_configured_origin()
    {
        presignedUrl = "http://10.0.2.2:9000/patika/incoming/station/x?sig=1";
        origins = new StorageOrigins(["http://10.0.2.2:9000", "http://storage.test"], StorageOrigins.DevelopmentCleartextHosts);
        var uploader = Uploader();
        var photo = await uploader.PrepareAsync(Picked(TestJpegs.Plain(16, 16)), Ct);

        Assert.Equal("station/0199f000-0000-7000-8000-000000000001", await uploader.UploadAsync(photo, "station", Ct));

        // A cleartext origin that is not a debug host is dropped from the list even when configured.
        presignedUrl = "http://storage.test/patika/incoming/station/x?sig=1";
        await Assert.ThrowsAsync<ApiException>(() => Uploader().UploadAsync(photo, "station", Ct));
        Assert.False(new StorageOrigins(["http://10.0.2.2:9000"]).Allows(new Uri("http://10.0.2.2:9000/x")));
        Assert.Single(puts);
    }

    [Fact]
    public async Task A_redirect_from_storage_is_a_failure_and_is_not_followed()
    {
        putStatus = HttpStatusCode.TemporaryRedirect;
        var uploader = Uploader();
        var photo = await uploader.PrepareAsync(Picked(TestJpegs.Plain(16, 16)), Ct);

        var e = await Assert.ThrowsAsync<ApiException>(() => uploader.UploadAsync(photo, "station", Ct));

        Assert.Equal(UploadErrors.PutFailedCode, e.Code);
        Assert.Single(puts);
    }

    [Fact]
    public async Task The_storage_client_does_not_follow_redirects()
    {
        var port = FreePort();
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        var hits = new List<string>();
        var serve = Task.Run(async () =>
        {
            for (var i = 0; i < 2; i++)
            {
                HttpListenerContext context;
                try
                {
                    context = await listener.GetContextAsync();
                }
                catch (HttpListenerException)
                {
                    return;
                }
                catch (ObjectDisposedException)
                {
                    return;
                }

                hits.Add(context.Request.Url!.AbsolutePath);
                context.Response.StatusCode = 307;
                context.Response.RedirectLocation = $"http://127.0.0.1:{port}/elsewhere";
                context.Response.Close();
            }
        }, Ct);

        using var client = StorageOrigins.CreateClient(TimeSpan.FromSeconds(10));
        using var response = await client.PutAsync($"http://127.0.0.1:{port}/upload", new ByteArrayContent([1, 2, 3]), Ct);

        Assert.Equal(HttpStatusCode.TemporaryRedirect, response.StatusCode);
        Assert.Equal(["/upload"], hits);
        listener.Stop();
        await serve;
    }

    private static int FreePort()
    {
        var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }
}
