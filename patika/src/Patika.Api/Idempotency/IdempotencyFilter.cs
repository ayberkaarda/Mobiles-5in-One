using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Security.Authorization;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Idempotency;

public static class IdempotencyErrorCodes
{
    /// <summary>The same key was used before with a different request.</summary>
    public const string Mismatch = "idempotency_mismatch";

    /// <summary>The header is present but not a UUID.</summary>
    public const string InvalidKey = "idempotency_key_invalid";

    /// <summary>The original request with this key is still running.</summary>
    public const string InProgress = "idempotency_in_progress";
}

public static class IdempotencyExtensions
{
    public const string HeaderName = "Idempotency-Key";

    /// <summary>Set to <c>true</c> on a response replayed from an earlier request.</summary>
    public const string ReplayedHeaderName = "Idempotent-Replayed";

    /// <summary>
    /// Makes the POST endpoints of a route group (or a single endpoint) idempotent per user and
    /// <c>Idempotency-Key</c>. Other methods pass through. Requests without the header behave as before.
    /// </summary>
    public static TBuilder WithIdempotency<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilterFactory(IdempotencyFilter.Create);
}

/// <summary>
/// Endpoint filter behind <see cref="IdempotencyExtensions.WithIdempotency{TBuilder}"/>.
/// <list type="bullet">
/// <item>The key row is inserted in a transaction on a separate connection and held until the response
/// is known, so concurrent requests with the same key wait on the unique index instead of running twice.</item>
/// <item>Only 2xx outcomes are kept (24 hours). Any other outcome rolls the row back, so the client may retry
/// with the same key.</item>
/// <item>The request hash covers method, path, query and the bound request values (not services); the
/// same key with a different request is 422 <c>idempotency_mismatch</c>.</item>
/// </list>
/// </summary>
internal sealed class IdempotencyFilter(int[] requestArgumentIndexes) : IEndpointFilter
{
    public static readonly TimeSpan Retention = TimeSpan.FromHours(24);

    /// <summary>How long a concurrent request waits for the original before 409 <c>idempotency_in_progress</c>.</summary>
    public static readonly TimeSpan WaitLimit = TimeSpan.FromSeconds(15);

    public const int MaxStoredBodyBytes = 64 * 1024;

    private const string LockNotAvailable = "55P03";

    private static readonly JsonSerializerOptions HashJson = new(JsonSerializerDefaults.Web);

    public static EndpointFilterDelegate Create(EndpointFilterFactoryContext context, EndpointFilterDelegate next)
    {
        var isService = context.ApplicationServices.GetService<IServiceProviderIsService>();
        var indexes = context.MethodInfo.GetParameters()
            .Where(parameter => IsRequestValue(parameter, isService))
            .Select(parameter => parameter.Position)
            .ToArray();
        var filter = new IdempotencyFilter(indexes);
        return invocation => filter.InvokeAsync(invocation, next);
    }

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (!HttpMethods.IsPost(http.Request.Method)
            || !http.Request.Headers.TryGetValue(IdempotencyExtensions.HeaderName, out var header))
        {
            return await next(context);
        }

        if (header.Count != 1 || !Guid.TryParseExact(header[0]?.Trim(), "D", out var key) || key == Guid.Empty)
        {
            return Problem(StatusCodes.Status400BadRequest, IdempotencyErrorCodes.InvalidKey,
                "Idempotency-Key must be a single UUID.");
        }

        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId)
        {
            return await next(context);
        }

        var services = http.RequestServices;
        var options = services.GetRequiredService<DbContextOptions<PatikaDbContext>>();
        var clock = services.GetRequiredService<TimeProvider>();
        var requestHash = HashRequest(context);
        var ct = http.RequestAborted;

        // A dedicated context: the handler's own DbContext and transactions stay untouched.
        await using var db = new PatikaDbContext(options);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var now = clock.GetUtcNow();
        Stored? existing;
        try
        {
            var lockTimeout = $"{(int)WaitLimit.TotalMilliseconds}ms";
            await db.Database.ExecuteSqlAsync($"SELECT set_config('lock_timeout', {lockTimeout}, true)", ct);
            await db.Database.ExecuteSqlAsync(
                $"DELETE FROM idempotency_keys WHERE user_id = {userId} AND key = {key} AND created_at <= {now - Retention}", ct);
            var claimed = await db.Database.ExecuteSqlAsync($"""
                INSERT INTO idempotency_keys (id, user_id, key, request_hash, status_code, response_body, created_at, updated_at)
                VALUES ({Guid.CreateVersion7()}, {userId}, {key}, {requestHash}, 0, {Array.Empty<byte>()}, {now}, {now})
                ON CONFLICT (user_id, key) DO NOTHING
                """, ct);
            existing = claimed == 1 ? null : await LoadAsync(db, userId, key, ct);
        }
        catch (Exception exception) when (IsLockTimeout(exception))
        {
            return Problem(StatusCodes.Status409Conflict, IdempotencyErrorCodes.InProgress,
                "A request with this Idempotency-Key is still being processed. Retry shortly.");
        }

        if (existing is not null)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            return CryptographicOperations.FixedTimeEquals(existing.RequestHash, requestHash)
                ? new ReplayResult(existing)
                : Problem(StatusCodes.Status422UnprocessableEntity, IdempotencyErrorCodes.Mismatch,
                    "This Idempotency-Key was already used with a different request.");
        }

        var captured = await CaptureAsync(http, await next(context));
        if (captured.StatusCode is >= 200 and < 300 && captured.Body.Length <= MaxStoredBodyBytes)
        {
            // The handler has finished; neither a disconnect nor a timeout may drop the record now.
            await db.Database.ExecuteSqlAsync($"""
                UPDATE idempotency_keys
                SET status_code = {captured.StatusCode}, content_type = {captured.ContentType},
                    location = {captured.Location}, response_body = {captured.Body},
                    updated_at = {clock.GetUtcNow()}
                WHERE user_id = {userId} AND key = {key}
                """, CancellationToken.None);
            await transaction.CommitAsync(CancellationToken.None);
        }
        else
        {
            await transaction.RollbackAsync(CancellationToken.None);
        }

        return new ReplayResult(captured with { Replayed = false });
    }

    /// <summary>Executes the handler's result into a buffer so it can be stored and then written.</summary>
    private static async Task<Stored> CaptureAsync(HttpContext http, object? value)
    {
        var result = value switch
        {
            IResult typed => typed,
            null => Results.Empty,
            string text => Results.Text(text),
            _ => Results.Json(value),
        };

        var original = http.Response.Body;
        using var buffer = new MemoryStream();
        http.Response.Body = buffer;
        try
        {
            await result.ExecuteAsync(http);
        }
        finally
        {
            http.Response.Body = original;
        }

        return new Stored(Array.Empty<byte>(), http.Response.StatusCode, http.Response.ContentType,
            http.Response.Headers.Location.ToString() is { Length: > 0 } location ? location : null, buffer.ToArray(), Replayed: false);
    }

    private static async Task<Stored?> LoadAsync(PatikaDbContext db, Guid userId, Guid key, CancellationToken ct)
    {
        var rows = await db.Database.SqlQuery<StoredRow>($"""
                SELECT request_hash AS "RequestHash", status_code AS "StatusCode", content_type AS "ContentType",
                    location AS "Location", response_body AS "ResponseBody"
                FROM idempotency_keys WHERE user_id = {userId} AND key = {key}
                """)
            .ToListAsync(ct);
        return rows.Count == 1
            ? new Stored(rows[0].RequestHash, rows[0].StatusCode, rows[0].ContentType, rows[0].Location, rows[0].ResponseBody, Replayed: true)
            : null;
    }

    private byte[] HashRequest(EndpointFilterInvocationContext context)
    {
        var request = context.HttpContext.Request;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(Encoding.UTF8.GetBytes($"{request.Method}\n{request.Path}\n{request.QueryString}\n"));
        foreach (var index in requestArgumentIndexes)
        {
            var argument = index < context.Arguments.Count ? context.Arguments[index] : null;
            hash.AppendData(argument is null
                ? "null"u8
                : JsonSerializer.SerializeToUtf8Bytes(argument, argument.GetType(), HashJson));
            hash.AppendData("\n"u8);
        }

        return hash.GetHashAndReset();
    }

    private static bool IsRequestValue(ParameterInfo parameter, IServiceProviderIsService? isService)
    {
        var type = parameter.ParameterType;
        if (type == typeof(HttpContext) || type == typeof(CancellationToken) || type == typeof(HttpRequest)
            || type == typeof(HttpResponse) || type == typeof(System.Security.Claims.ClaimsPrincipal)
            || parameter.GetCustomAttribute<FromServicesAttribute>() is not null
            || parameter.GetCustomAttribute<FromKeyedServicesAttribute>() is not null)
        {
            return false;
        }

        return isService?.IsService(type) != true;
    }

    private static bool IsLockTimeout(Exception exception) =>
        exception is Npgsql.PostgresException { SqlState: LockNotAvailable }
        || exception.InnerException is Npgsql.PostgresException { SqlState: LockNotAvailable };

    private static IResult Problem(int status, string code, string title) =>
        TypedResults.Problem(title: title, statusCode: status, extensions: new Dictionary<string, object?> { ["code"] = code });

    private sealed record StoredRow(byte[] RequestHash, int StatusCode, string? ContentType, string? Location, byte[] ResponseBody);

    internal sealed record Stored(
        byte[] RequestHash, int StatusCode, string? ContentType, string? Location, byte[] Body, bool Replayed);

    /// <summary>Writes a captured or stored response as-is.</summary>
    private sealed class ReplayResult(Stored stored) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            var response = httpContext.Response;
            response.StatusCode = stored.StatusCode;
            if (stored.ContentType is not null)
            {
                response.ContentType = stored.ContentType;
            }

            if (stored.Location is not null)
            {
                response.Headers.Location = stored.Location;
            }

            if (stored.Replayed)
            {
                response.Headers[IdempotencyExtensions.ReplayedHeaderName] = "true";
            }

            if (stored.Body.Length > 0)
            {
                await response.Body.WriteAsync(stored.Body, httpContext.RequestAborted);
            }
        }
    }
}
