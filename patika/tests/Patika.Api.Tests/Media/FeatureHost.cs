using System.Collections.Concurrent;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Patika.Api.Features.Auth;
using Patika.Api.Features.Devices;
using Patika.Api.Features.Media;
using Patika.Api.Features.Urgent;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Patika.Infrastructure;
using Patika.Infrastructure.Media;

namespace Patika.Api.Tests.Media;

/// <summary>
/// The production pipeline (<c>AddPatikaApi</c>/<c>UsePatikaApi</c>) with the media, urgent and
/// device slices wired exactly as Program.cs is expected to wire them, and their stores in memory.
/// </summary>
public sealed class FeatureHost : IAsyncDisposable
{
    private readonly WebApplication app;

    private FeatureHost(WebApplication app, FeatureStores stores)
    {
        this.app = app;
        Stores = stores;
        Client = app.GetTestClient();
    }

    public FeatureStores Stores { get; }

    public HttpClient Client { get; }

    public static async Task<FeatureHost> StartAsync(Action<IServiceCollection>? configure = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:SigningKey"] = PatikaApiFactory.SigningKey,
            ["Storage:Endpoint"] = "http://127.0.0.1:9",
            ["Storage:PublicEndpoint"] = "https://media.patika.test",
            ["Storage:Bucket"] = "patika-test",
            ["Storage:AccessKey"] = "test-access",
            ["Storage:SecretKey"] = "test-secret-value",
        });
        builder.AddPatikaApi();
        builder.Services.AddPatikaInfrastructure("Host=127.0.0.1;Port=1;Database=none;Timeout=1");
        builder.Services.AddMediaServices(builder.Configuration);
        builder.Services.AddUrgentServices();
        builder.Services.AddDeviceServices();

        var stores = new FeatureStores();
        builder.Services.RemoveAll<IAuthStore>();
        builder.Services.AddSingleton<IAuthStore>(stores.Auth);
        builder.Services.RemoveAll<IUploadLedger>();
        builder.Services.AddSingleton<IUploadLedger>(stores.Uploads);
        builder.Services.RemoveAll<ISupporterEntitlement>();
        builder.Services.AddSingleton<ISupporterEntitlement>(stores.Supporters);
        builder.Services.RemoveAll<IUrgentStore>();
        builder.Services.AddSingleton<IUrgentStore>(stores.Urgent);
        builder.Services.RemoveAll<IDeviceStore>();
        builder.Services.AddSingleton<IDeviceStore>(stores.Devices);
        configure?.Invoke(builder.Services);

        var app = builder.Build();
        app.UsePatikaApi();
        var v1 = app.MapGroup("/v1");
        v1.MapMediaEndpoints();
        v1.MapUrgentEndpoints();
        v1.MapDeviceEndpoints();
        await app.StartAsync();
        return new FeatureHost(app, stores);
    }

    /// <summary>Creates an active, verified user and returns a client authenticated as them.</summary>
    public async Task<(Guid UserId, HttpClient Client)> SignInAsync(ActorRole role = ActorRole.User)
    {
        var id = Guid.CreateVersion7();
        await Stores.Auth.TryCreateUserAsync(
            new AuthUser(id, $"gonullu.{id:N}@example.org", null, "Mahalle Gönüllüsü", role, DateTimeOffset.UtcNow, null),
            null, null, CancellationToken.None);
        Stores.Devices.Settings[id] = new UrgentSettings(false, null, 2000);
        var token = app.Services.GetRequiredService<IAccessTokenIssuer>().Issue(id, role).Token;
        var client = app.GetTestClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (id, client);
    }

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await app.DisposeAsync();
    }
}

public sealed class FeatureStores
{
    public InMemoryAuthStore Auth { get; } = new();

    public InMemoryUploadLedger Uploads { get; } = new();

    public FakeSupporterEntitlement Supporters { get; } = new();

    public InMemoryUrgentStore Urgent { get; } = new();

    public InMemoryDeviceStore Devices { get; } = new();
}

public sealed class InMemoryUploadLedger : IUploadLedger
{
    private readonly Lock gate = new();

    public List<UploadReservation> Reservations { get; } = [];

    public HashSet<string> Quarantined { get; } = new(StringComparer.Ordinal);

    public Task<int?> TryReserveAsync(UploadReservation upload, DateTimeOffset dayStart, int limit, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            var used = Reservations.Count(r => r.UserId == upload.UserId && r.CreatedAt >= dayStart);
            if (used >= limit)
            {
                return Task.FromResult<int?>(null);
            }

            Reservations.Add(upload);
            return Task.FromResult<int?>(limit - used - 1);
        }
    }

    public Task<bool> IsUsableByAsync(Guid userId, string photoKey, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            return Task.FromResult(!Quarantined.Contains(photoKey)
                && Reservations.Any(r => r.UserId == userId && r.PhotoKey == photoKey));
        }
    }
}

public sealed class FakeSupporterEntitlement : ISupporterEntitlement
{
    public ConcurrentDictionary<Guid, bool> Supporters { get; } = new();

    public Task<bool> IsSupporterAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken) =>
        Task.FromResult(Supporters.ContainsKey(userId));
}

public sealed class InMemoryUrgentStore : IUrgentStore
{
    private readonly Lock gate = new();

    public Dictionary<Guid, UrgentPostRecord> Posts { get; } = [];

    public Task<bool> TryCreateAsync(UrgentPostRecord post, DateTimeOffset dayStart, int dailyCap, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            if (Posts.Values.Count(p => p.CreatedBy == post.CreatedBy && p.CreatedAt >= dayStart) >= dailyCap)
            {
                return Task.FromResult(false);
            }

            Posts[post.Id] = post;
            return Task.FromResult(true);
        }
    }

    public Task<UrgentPostRecord?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            return Task.FromResult(Posts.GetValueOrDefault(id) is { Hidden: false } post ? post : null);
        }
    }

    public Task<UrgentPostRecord?> FindForManagementAsync(Guid id, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            return Task.FromResult(Posts.GetValueOrDefault(id));
        }
    }

    public Task UpdateStateAsync(Guid id, UrgentPostState state, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            Posts[id] = Posts[id] with { State = state };
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<UrgentPostRecord>> NearAsync(GeoPoint center, int radiusMeters, int limit, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            IReadOnlyList<UrgentPostRecord> result = [.. Posts.Values
                .Where(p => p.State == UrgentPostState.Open && !p.Hidden)
                .Select(p => p with { DistanceMeters = (int)Haversine(center, p.Location) })
                .Where(p => p.DistanceMeters <= radiusMeters)
                .OrderBy(p => p.DistanceMeters)
                .Take(limit)];
            return Task.FromResult(result);
        }
    }

    private static double Haversine(GeoPoint a, GeoPoint b)
    {
        const double R = 6_371_000;
        var dLat = (b.Latitude - a.Latitude) * Math.PI / 180;
        var dLng = (b.Longitude - a.Longitude) * Math.PI / 180;
        var h = Math.Pow(Math.Sin(dLat / 2), 2)
            + Math.Cos(a.Latitude * Math.PI / 180) * Math.Cos(b.Latitude * Math.PI / 180) * Math.Pow(Math.Sin(dLng / 2), 2);
        return 2 * R * Math.Asin(Math.Sqrt(h));
    }
}

public sealed class InMemoryDeviceStore : IDeviceStore
{
    private readonly Lock gate = new();

    public Dictionary<string, (Guid UserId, Guid InstallationId, StoreEnvironment Environment, DateTimeOffset LastSeen)> Tokens { get; } =
        new(StringComparer.Ordinal);

    public ConcurrentDictionary<Guid, UrgentSettings> Settings { get; } = new();

    public Task<DeviceRegistration> RegisterAsync(Guid userId, Guid installationId, string token, StoreEnvironment environment,
        DateTimeOffset now, int maxPerUser, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            if (Tokens.TryGetValue(token, out var held) && held.InstallationId != installationId)
            {
                return Task.FromResult(DeviceRegistration.TokenInUse);
            }

            foreach (var previous in Tokens.Where(t => t.Value.InstallationId == installationId).Select(t => t.Key).ToList())
            {
                Tokens.Remove(previous);
            }

            Tokens[token] = (userId, installationId, environment, now);
            foreach (var surplus in Tokens.Where(t => t.Value.UserId == userId).OrderByDescending(t => t.Value.LastSeen)
                .Skip(maxPerUser).Select(t => t.Key).ToList())
            {
                Tokens.Remove(surplus);
            }
        }

        return Task.FromResult(DeviceRegistration.Registered);
    }

    public Task UnregisterAsync(Guid userId, string token, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            if (Tokens.TryGetValue(token, out var entry) && entry.UserId == userId)
            {
                Tokens.Remove(token);
            }
        }

        return Task.CompletedTask;
    }

    public Task<UrgentSettings?> GetUrgentSettingsAsync(Guid userId, CancellationToken cancellationToken) =>
        Task.FromResult(Settings.TryGetValue(userId, out var settings) ? settings : null);

    public Task SetUrgentSettingsAsync(Guid userId, UrgentSettings settings, CancellationToken cancellationToken)
    {
        Settings[userId] = settings;
        return Task.CompletedTask;
    }
}
