using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Patika.Contracts.Auth;

namespace Patika.Api.Security.RateLimiting;

public static class RateLimitPolicies
{
    /// <summary>
    /// TOTP verification routes (<c>/auth/mfa</c>, <c>/me/totp/*</c>, <c>/admin/step-up</c>): a loose ceiling of 100 per
    /// 15 minutes per client IP. The real budget is per user, see <see cref="TotpRateLimiter"/>.
    /// </summary>
    public const string Totp = "totp";

    /// <summary>Register and login: 5 per 15 minutes per client IP (and per normalized email in the handler).</summary>
    public const string Auth = "auth";

    /// <summary>External identity sign-in: 10 per 15 minutes per client IP.</summary>
    public const string External = "external";

    /// <summary>Email verification codes: 10 per 15 minutes per client IP.</summary>
    public const string Verify = "verify";
}

/// <summary>
/// Sliding-window limiters keyed by a value only known inside a handler (normalized email,
/// refresh-token owner). Each instance is a singleton for the lifetime of the process.
/// </summary>
public sealed class KeyedRateLimiter : IDisposable
{
    private readonly PartitionedRateLimiter<string> limiter;
    private readonly TimeSpan fallbackRetryAfter;

    public KeyedRateLimiter(int permitLimit, TimeSpan window, int segments)
    {
        fallbackRetryAfter = window / segments;
        limiter = PartitionedRateLimiter.Create<string, string>(key =>
            RateLimitPartition.GetSlidingWindowLimiter(key, _ => SlidingOptions(permitLimit, window, segments)));
    }

    /// <summary>Returns <c>null</c> when permitted, otherwise the time after which the caller may retry.</summary>
    public TimeSpan? TryAcquire(string key)
    {
        using var lease = limiter.AttemptAcquire(key);
        if (lease.IsAcquired)
        {
            return null;
        }

        return lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter) && retryAfter > TimeSpan.Zero
            ? retryAfter
            : fallbackRetryAfter;
    }

    public void Dispose() => limiter.Dispose();

    internal static SlidingWindowRateLimiterOptions SlidingOptions(int permitLimit, TimeSpan window, int segments) => new()
    {
        PermitLimit = permitLimit,
        Window = window,
        SegmentsPerWindow = segments,
        QueueLimit = 0,
        AutoReplenishment = true,
    };
}

/// <summary>Limiter for the normalized email on register and login.</summary>
public sealed class EmailRateLimiter() : IDisposable
{
    public KeyedRateLimiter Limiter { get; } = new(5, TimeSpan.FromMinutes(15), 15);

    public void Dispose() => Limiter.Dispose();
}

/// <summary>
/// Per-user budget for TOTP verification: 20 per 15 minutes, keyed by the authenticated user or, on
/// <c>/auth/mfa</c>, by the user the MFA challenge belongs to. Separate from the per-IP login bucket, so
/// admins behind one address (the Web BFF) do not share or burn each other's budget.
/// </summary>
public sealed class TotpRateLimiter() : IDisposable
{
    public KeyedRateLimiter Limiter { get; } = new(20, TimeSpan.FromMinutes(15), 15);

    public void Dispose() => Limiter.Dispose();
}

/// <summary>Limiter for refresh, keyed by the user that owns the presented token.</summary>
public sealed class RefreshRateLimiter() : IDisposable
{
    public KeyedRateLimiter Limiter { get; } = new(30, TimeSpan.FromMinutes(1), 6);

    public void Dispose() => Limiter.Dispose();
}

public static class RateLimitingSetup
{
    public static IServiceCollection AddPatikaRateLimiting(this IServiceCollection services)
    {
        services.AddSingleton<EmailRateLimiter>();
        services.AddSingleton<RefreshRateLimiter>();
        services.AddSingleton<TotpRateLimiter>();
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, cancellationToken) =>
            {
                var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var value) && value > TimeSpan.Zero
                    ? value
                    : TimeSpan.FromMinutes(1);
                await WriteRejectionAsync(context.HttpContext, retryAfter);
            };

            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                RateLimitPartition.GetSlidingWindowLimiter(
                    "global:" + ClientIp(context),
                    _ => KeyedRateLimiter.SlidingOptions(300, TimeSpan.FromMinutes(1), 6)));

            options.AddPolicy(RateLimitPolicies.Auth, context =>
                RateLimitPartition.GetSlidingWindowLimiter(
                    "auth:" + ClientIp(context),
                    _ => KeyedRateLimiter.SlidingOptions(5, TimeSpan.FromMinutes(15), 15)));

            options.AddPolicy(RateLimitPolicies.Totp, context =>
                RateLimitPartition.GetSlidingWindowLimiter(
                    "totp:" + ClientIp(context),
                    _ => KeyedRateLimiter.SlidingOptions(100, TimeSpan.FromMinutes(15), 15)));

            options.AddPolicy(RateLimitPolicies.External, context =>
                RateLimitPartition.GetSlidingWindowLimiter(
                    "external:" + ClientIp(context),
                    _ => KeyedRateLimiter.SlidingOptions(10, TimeSpan.FromMinutes(15), 15)));

            options.AddPolicy(RateLimitPolicies.Verify, context =>
                RateLimitPartition.GetSlidingWindowLimiter(
                    "verify:" + ClientIp(context),
                    _ => KeyedRateLimiter.SlidingOptions(10, TimeSpan.FromMinutes(15), 15)));
        });
        return services;
    }

    /// <summary>
    /// The client address after <c>ForwardedHeaders</c> processing. Forwarded headers are only applied
    /// when the immediate peer is a configured known proxy, so a spoofed <c>X-Forwarded-For</c> from any
    /// other peer leaves this value unchanged.
    /// </summary>
    public static string ClientIp(HttpContext context) => PartitionKey(context.Connection.RemoteIpAddress);

    /// <summary>
    /// IPv4 (including IPv4-mapped IPv6) partitions per address; IPv6 partitions per /64, because a
    /// single subscriber usually controls a whole /64 and could otherwise rotate addresses freely.
    /// </summary>
    public static string PartitionKey(System.Net.IPAddress? address)
    {
        if (address is null)
        {
            return "unknown";
        }

        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        if (address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6)
        {
            return address.ToString();
        }

        Span<byte> bytes = stackalloc byte[16];
        address.TryWriteBytes(bytes, out _);
        bytes[8..].Clear();
        return new System.Net.IPAddress(bytes).ToString() + "/64";
    }

    public static IResult TooManyRequests(HttpContext context, TimeSpan retryAfter)
    {
        SetRetryAfter(context, retryAfter);
        return TypedResults.Problem(
            title: "Too many requests.",
            statusCode: StatusCodes.Status429TooManyRequests,
            extensions: new Dictionary<string, object?> { ["code"] = AuthErrorCodes.RateLimited });
    }

    private static async Task WriteRejectionAsync(HttpContext context, TimeSpan retryAfter)
    {
        await TooManyRequests(context, retryAfter).ExecuteAsync(context);
    }

    private static void SetRetryAfter(HttpContext context, TimeSpan retryAfter)
    {
        var seconds = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds));
        context.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
    }
}

/// <summary>A 429 problem with <c>Retry-After</c>, for limits enforced inside a handler.</summary>
public sealed class RetryLaterResult(TimeSpan retryAfter) : IResult, IStatusCodeHttpResult
{
    public int? StatusCode => StatusCodes.Status429TooManyRequests;

    public Task ExecuteAsync(HttpContext httpContext) =>
        RateLimitingSetup.TooManyRequests(httpContext, retryAfter).ExecuteAsync(httpContext);
}
