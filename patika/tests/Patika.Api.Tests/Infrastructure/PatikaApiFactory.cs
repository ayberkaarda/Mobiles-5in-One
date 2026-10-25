using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Api.Email;
using Patika.Api.Features.Account;
using Patika.Api.Features.Auth;
using Patika.Api.Security.Passwords;
using Patika.Api.Security.Tokens;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Compact;

namespace Patika.Api.Tests.Infrastructure;

/// <summary>
/// The real API pipeline with the database, the breach corpus and Google replaced by in-process fakes.
/// No test touches the network. The TCP peer is simulated with the <see cref="PeerHeader"/> header.
/// </summary>
public sealed class PatikaApiFactory : WebApplicationFactory<Program>
{
    public const string PeerHeader = "X-Test-Peer";
    public const string DefaultPeer = "203.0.113.10";

    // One P-256 key per test process, created at runtime and never written to disk.
    public static readonly string SigningKey = CreateSigningKey();

    public InMemoryAuthStore Store { get; } = new();

    public FakeBreachedPasswordChecker Breached { get; } = new();

    public FakeExternalIdentityVerifier Google { get; } = new();

    public LogCollector Logs { get; } = new();

    public TestOutbox Outbox { get; } = new();

    /// <summary>Per-user contribution counts for <c>GET /v1/me</c>; accounts default to zero.</summary>
    public InMemoryAccountStats Stats => field ??= new InMemoryAccountStats(Store);

    public Dictionary<string, string?> Settings { get; } = new(StringComparer.Ordinal);

    public Action<IServiceCollection>? ExtraServices { get; set; }

    public static string CreateSigningKey()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return Convert.ToBase64String(key.ExportPkcs8PrivateKey());
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Jwt:SigningKey", SigningKey);
        builder.UseSetting("Google:ClientIds:0", FakeExternalIdentityVerifier.ClientId);
        builder.UseSetting("ConnectionStrings:Patika", "Host=127.0.0.1;Port=1;Database=none;Timeout=1");
        foreach (var (key, value) in Settings)
        {
            builder.UseSetting(key, value);
        }

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IAccountStatsReader>();
            services.AddSingleton<IAccountStatsReader>(Stats);
            services.RemoveAll<IAuthStore>();
            services.AddSingleton<IAuthStore>(Store);
            services.RemoveAll<IBreachedPasswordChecker>();
            services.AddSingleton<IBreachedPasswordChecker>(Breached);
            services.RemoveAll<IExternalIdentityVerifier>();
            services.AddSingleton<IExternalIdentityVerifier>(Google);
            services.AddSingleton<ILogEventSink>(Logs);
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(Outbox);
            services.AddSingleton<IStartupFilter, PeerAddressStartupFilter>();
            ExtraServices?.Invoke(services);
        });
    }

    public HttpClient CreateApiClient(string? peer = null)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add(PeerHeader, peer ?? DefaultPeer);
        return client;
    }

    private sealed class PeerAddressStartupFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (context, nextMiddleware) =>
            {
                var peer = context.Request.Headers[PeerHeader].ToString();
                context.Connection.RemoteIpAddress = IPAddress.Parse(peer.Length == 0 ? DefaultPeer : peer);
                context.Request.Headers.Remove(PeerHeader);
                await nextMiddleware(context);
            });
            next(app);
        };
    }
}

public sealed class FakeBreachedPasswordChecker : IBreachedPasswordChecker
{
    private readonly ConcurrentDictionary<string, bool> breached = new(StringComparer.Ordinal);

    public int Calls;

    public void MarkBreached(string password) => breached[password] = true;

    public Task<bool> IsBreachedAsync(string password, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref Calls);
        return Task.FromResult(breached.ContainsKey(password));
    }
}

public sealed class FakeExternalIdentityVerifier : IExternalIdentityVerifier
{
    public const string ClientId = "patika-android-test.apps.example";

    private readonly ConcurrentDictionary<string, ExternalIdentity> tokens = new(StringComparer.Ordinal);

    public string Provider => GoogleIdTokenVerifier.ProviderName;

    /// <summary>Registers an identity and returns a JWT-shaped opaque token for it.</summary>
    public string Issue(string subject, string? email, bool emailVerified, string? name = "Kedi Dostu")
    {
        var token = $"h.{Guid.NewGuid():N}.s";
        tokens[token] = new ExternalIdentity(Provider, subject, email, emailVerified, name);
        return token;
    }

    public Task<ExternalIdentity?> VerifyAsync(string token, CancellationToken cancellationToken) =>
        Task.FromResult(tokens.TryGetValue(token, out var identity) ? identity : null);
}

public sealed class LogCollector : ILogEventSink
{
    private static readonly RenderedCompactJsonFormatter Formatter = new();
    private readonly ConcurrentQueue<LogEvent> events = new();

    public IReadOnlyCollection<LogEvent> Events => events.ToArray();

    public void Emit(LogEvent logEvent) => events.Enqueue(logEvent);

    public IReadOnlyList<string> RenderAll() => events.Select(Render).ToArray();

    public static string Render(LogEvent logEvent)
    {
        using var writer = new StringWriter(CultureInfo.InvariantCulture);
        Formatter.Format(logEvent, writer);
        return writer.ToString();
    }
}

/// <summary>Captures outgoing email instead of sending it.</summary>
public sealed class TestOutbox : IEmailSender
{
    private readonly ConcurrentQueue<EmailMessage> messages = new();

    public IReadOnlyList<EmailMessage> Messages => [.. messages];

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        messages.Enqueue(message);
        return Task.CompletedTask;
    }

    public IReadOnlyList<EmailMessage> For(string email) =>
        [.. messages.Where(m => string.Equals(m.To, email, StringComparison.OrdinalIgnoreCase))];

    /// <summary>The newest verification code sent to the address.</summary>
    public string VerificationCodeFor(string email) =>
        For(email).Last(m => m.Kind == EmailKind.VerifyEmail).Body
            .Split('\n').Select(line => line.Trim()).Single(EmailCodeHasher.LooksValid);
}

/// <summary>
/// <see cref="IAccountStatsReader"/> over the in-memory users: counts are set per user by the test,
/// <c>JoinedAt</c> is fixed per user the first time it is read.
/// </summary>
public sealed class InMemoryAccountStats(InMemoryAuthStore users) : IAccountStatsReader
{
    private readonly ConcurrentDictionary<Guid, AccountStats> stats = new();

    public void Set(Guid userId, int feedings = 0, int sightings = 0, int adoptionsHelped = 0, DateTimeOffset? joinedAt = null) =>
        stats[userId] = new AccountStats(feedings, sightings, adoptionsHelped, joinedAt ?? DateTimeOffset.UtcNow);

    public Task<AccountStats?> ReadAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (users.Users.All(u => u.Id != userId))
        {
            return Task.FromResult<AccountStats?>(null);
        }

        return Task.FromResult<AccountStats?>(stats.GetOrAdd(userId, _ => new AccountStats(0, 0, 0, DateTimeOffset.UtcNow)));
    }
}
