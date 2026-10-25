using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;

namespace Patika.Api.Security;

public sealed class NetworkSettings
{
    public const string SectionName = "Network";

    /// <summary>Addresses of reverse proxies whose <c>X-Forwarded-*</c> headers are trusted.</summary>
    public string[] KnownProxies { get; set; } = [];

    /// <summary>CIDR ranges of trusted reverse proxies.</summary>
    public string[] KnownNetworks { get; set; } = [];
}

public sealed class CorsSettings
{
    public const string SectionName = "Cors";
    public const string PolicyName = "patika-web";

    /// <summary>Off in the MVP: there is no browser client, so no CORS headers are emitted.</summary>
    public bool Enabled { get; set; }

    public string[] AllowedOrigins { get; set; } = [];
}

public static class HttpHardening
{
    public const long MaxRequestBodyBytes = 1024 * 1024;

    public static IServiceCollection AddPatikaHttpHardening(this IServiceCollection services, IConfiguration configuration)
    {
        var network = configuration.GetSection(NetworkSettings.SectionName).Get<NetworkSettings>() ?? new NetworkSettings();
        var proxies = TrustedProxies(network);
        var networks = TrustedNetworks(network);
        services.Configure<ForwardedHeadersOptions>(options =>
        {
            // With no trusted proxy configured, forwarded headers are never processed. Empty lists in
            // ForwardedHeadersOptions would otherwise mean "trust every peer".
            options.ForwardedHeaders = proxies.Length + networks.Length == 0
                ? ForwardedHeaders.None
                : ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.ForwardLimit = 1;
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();
            foreach (var proxy in proxies)
            {
                options.KnownProxies.Add(proxy);
            }

            foreach (var range in networks)
            {
                options.KnownIPNetworks.Add(range);
            }
        });

        var cors = configuration.GetSection(CorsSettings.SectionName).Get<CorsSettings>() ?? new CorsSettings();
        if (cors.Enabled)
        {
            services.AddCors(options => options.AddPolicy(CorsSettings.PolicyName, policy => policy
                .WithOrigins(cors.AllowedOrigins)
                .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE")
                .WithHeaders("Authorization", "Content-Type")));
        }

        return services;
    }

    /// <summary>True when at least one trusted proxy or network is configured.</summary>
    public static bool HasTrustedProxies(IConfiguration configuration)
    {
        var network = configuration.GetSection(NetworkSettings.SectionName).Get<NetworkSettings>() ?? new NetworkSettings();
        return TrustedProxies(network).Length + TrustedNetworks(network).Length > 0;
    }

    private static IPAddress[] TrustedProxies(NetworkSettings network) =>
        [.. network.KnownProxies.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => IPAddress.Parse(p.Trim()))];

    private static System.Net.IPNetwork[] TrustedNetworks(NetworkSettings network) =>
        [.. network.KnownNetworks.Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => System.Net.IPNetwork.Parse(n.Trim()))];

    public static bool IsCorsEnabled(IConfiguration configuration) =>
        configuration.GetSection(CorsSettings.SectionName).Get<CorsSettings>()?.Enabled == true;

    /// <summary>Response headers for every API response, including errors and rate-limit rejections.</summary>
    public static IApplicationBuilder UseApiSecurityHeaders(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                var headers = context.Response.Headers;
                headers.CacheControl = "no-store";
                headers.Pragma = "no-cache";
                headers.XContentTypeOptions = "nosniff";
                headers.XFrameOptions = "DENY";
                headers["Referrer-Policy"] = "no-referrer";
                headers.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";
                headers["Cross-Origin-Resource-Policy"] = "same-origin";
                headers.Remove("Server");
                headers.Remove("X-Powered-By");
                return Task.CompletedTask;
            });
            await next(context);
        });

    /// <summary>
    /// JSON bodies are limited to 1 MB. Kestrel enforces the same limit; this middleware covers hosts
    /// without a body-size feature and requests that declare an oversized <c>Content-Length</c>.
    /// </summary>
    public static IApplicationBuilder UseRequestBodyLimit(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            var feature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (feature is { IsReadOnly: false })
            {
                feature.MaxRequestBodySize = MaxRequestBodyBytes;
            }

            if (context.Request.ContentLength > MaxRequestBodyBytes)
            {
                await TypedResults.Problem(
                    title: "Request body too large.",
                    statusCode: StatusCodes.Status413PayloadTooLarge).ExecuteAsync(context);
                return;
            }

            if (context.Request.ContentLength is null && context.Request.Body.CanRead)
            {
                context.Request.Body = new LengthLimitedStream(context.Request.Body, MaxRequestBodyBytes);
            }

            await next(context);
        });

    public static string TraceId(HttpContext context) => Activity.Current?.Id ?? context.TraceIdentifier;
}

/// <summary>Read-only stream wrapper that fails once more than the allowed number of bytes is read.</summary>
internal sealed class LengthLimitedStream(Stream inner, long limit) : Stream
{
    private long total;

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => total;
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count) => Count(inner.Read(buffer, offset, count));

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
        Count(await inner.ReadAsync(buffer, cancellationToken));

    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    private int Count(int read)
    {
        total += read;
        if (total > limit)
        {
            throw new BadHttpRequestException("Request body too large.", StatusCodes.Status413PayloadTooLarge);
        }

        return read;
    }
}
