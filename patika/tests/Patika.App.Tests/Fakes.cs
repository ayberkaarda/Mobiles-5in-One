using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Patika.App.Core.Api;
using Patika.App.Core.Offline;
using Patika.Contracts.Auth;

namespace Patika.App.Tests;

internal sealed class ManualClock(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset now = start;

    public ManualClock() : this(new DateTimeOffset(2026, 10, 25, 9, 0, 0, TimeSpan.Zero))
    {
    }

    public override DateTimeOffset GetUtcNow() => now;

    public void Advance(TimeSpan by) => now += by;
}

internal sealed class MemoryTokenStore : ITokenStore
{
    public StoredSession? Session { get; set; }

    public int Clears { get; private set; }

    public Task<StoredSession?> GetAsync() => Task.FromResult(Session);

    public Task SetAsync(StoredSession session)
    {
        Session = session;
        return Task.CompletedTask;
    }

    public Task ClearAsync()
    {
        Session = null;
        Clears++;
        return Task.CompletedTask;
    }
}

internal sealed class FakeNetwork(bool online = true) : INetworkStatus
{
    public bool IsOnline { get; private set; } = online;

    public event EventHandler<bool>? Changed;

    public void Set(bool online)
    {
        IsOnline = online;
        Changed?.Invoke(this, online);
    }
}

/// <summary>Routes requests to a lambda and records them (with bodies read up front).</summary>
internal sealed class FakeHandler(Func<RecordedRequest, Task<HttpResponseMessage>> respond) : HttpMessageHandler
{
    public ConcurrentQueue<RecordedRequest> Requests { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        var recorded = new RecordedRequest(
            request.Method,
            request.RequestUri!.PathAndQuery,
            request.Headers.Authorization?.Parameter,
            request.Headers.TryGetValues(PatikaApiClient.IdempotencyHeader, out var keys) ? keys.Single() : null,
            body);
        Requests.Enqueue(recorded);
        return await respond(recorded);
    }

    public int Count(string pathPrefix) => Requests.Count(r => r.Path.StartsWith(pathPrefix, StringComparison.Ordinal));
}

internal sealed record RecordedRequest(HttpMethod Method, string Path, string? Bearer, string? IdempotencyKey, string? Body);

internal static class Http
{
    public static HttpResponseMessage Json(HttpStatusCode status, object body) => new(status)
    {
        Content = new StringContent(JsonSerializer.Serialize(body, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            Encoding.UTF8, "application/json"),
    };

    public static HttpResponseMessage Problem(int status, string code, string title = "Problem",
        object? errors = null)
    {
        var json = JsonSerializer.Serialize(new { type = "about:blank", title, status, code, traceId = "t", errors },
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return new HttpResponseMessage((HttpStatusCode)status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/problem+json"),
        };
    }

    public static Task<HttpResponseMessage> Done(HttpResponseMessage message) => Task.FromResult(message);

    /// <summary>An unsigned JWT with the given subject; the client only reads <c>sub</c>.</summary>
    public static string Jwt(string subject, string salt = "")
    {
        static string Part(string json) => Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return $"{Part("{\"alg\":\"none\"}")}.{Part($"{{\"sub\":\"{subject}\",\"n\":\"{salt}\"}}")}.sig";
    }

    public static TokenResponse Tokens(string subject, string salt, int expiresIn = 900) =>
        new(Jwt(subject, salt), "Bearer", expiresIn, "refresh-" + salt, 2_592_000);
}

/// <summary>A throwaway SQLite file per test.</summary>
internal sealed class TempDatabase : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), "patika-app-tests", Guid.NewGuid().ToString("N"));

    public TempDatabase()
    {
        Directory.CreateDirectory(folder);
        Database = new OfflineDatabase(Path.Combine(folder, "offline.db"));
    }

    public OfflineDatabase Database { get; }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try
        {
            Directory.Delete(folder, recursive: true);
        }
        catch (IOException)
        {
            // A handle still closing on Windows; the temp folder is cleaned by the OS.
        }
    }
}
