using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Devices;
using Patika.Api.Features.Media;
using Patika.Api.Features.Urgent;
using Patika.Contracts.Media;
using Patika.Domain;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Api.Tests.Urgent;

/// <summary>The EF/SQL stores behind the media, urgent and device endpoints, on real PostGIS.</summary>
public sealed class StorePostgisTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task ConcurrentPresignsCannotOverrunTheUploadQuota()
    {
        var userId = await database.CreateUserAsync(Ct);
        var now = DateTimeOffset.UtcNow;
        var results = await Task.WhenAll(Enumerable.Range(0, 40).Select(async _ =>
        {
            await using var db = database.CreateContext();
            var id = Guid.CreateVersion7();
            return await new PgUploadLedger(db).TryReserveAsync(
                new UploadReservation(id, userId, "station", MediaKeys.PhotoKey("station", id), "image/jpeg", 1000, now),
                PatikaDay.StartOf(now), 30, Ct);
        }));

        Assert.Equal(30, results.Count(r => r is not null));
        Assert.Equal(10, results.Count(r => r is null));
        await using var check = database.CreateContext();
        var rows = await check.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM uploads WHERE user_id = {userId}").SingleAsync(Ct);
        Assert.Equal(30, rows);
    }

    [Fact]
    public async Task PhotoKeysAreUsableOnlyByTheirUploaderAndNotOnceQuarantined()
    {
        var owner = await database.CreateUserAsync(Ct);
        var stranger = await database.CreateUserAsync(Ct);
        var id = Guid.CreateVersion7();
        var key = MediaKeys.PhotoKey("urgent", id);
        await using var db = database.CreateContext();
        var ledger = new PgUploadLedger(db);
        var now = DateTimeOffset.UtcNow;
        await ledger.TryReserveAsync(new UploadReservation(id, owner, "urgent", key, "image/png", 10, now), PatikaDay.StartOf(now), 30, Ct);

        Assert.True(await ledger.IsUsableByAsync(owner, key, Ct));
        Assert.False(await ledger.IsUsableByAsync(stranger, key, Ct));
        await db.Database.ExecuteSqlAsync($"UPDATE uploads SET state = 'Quarantined' WHERE key = {key}", Ct);
        Assert.False(await ledger.IsUsableByAsync(owner, key, Ct));
    }

    [Fact]
    public async Task ConcurrentUrgentPostsStopAtThreePerDay()
    {
        var author = await database.CreateUserAsync(Ct);
        var now = DateTimeOffset.UtcNow;
        var created = await Task.WhenAll(Enumerable.Range(0, 6).Select(async i =>
        {
            await using var db = database.CreateContext();
            return await new EfUrgentStore(db).TryCreateAsync(Post(author, 41.0 + i * 0.001, 29.0), PatikaDay.StartOf(now), 3, Ct);
        }));

        Assert.Equal(3, created.Count(c => c));
        await using var check = database.CreateContext();
        Assert.Equal(3, await check.UrgentPosts.CountAsync(p => p.CreatedBy == author, Ct));
    }

    [Fact]
    public async Task NearReturnsOpenPostsInsideTheRadiusNearestFirst()
    {
        var author = await database.CreateUserAsync(Ct);
        await using var db = database.CreateContext();
        var store = new EfUrgentStore(db);
        var start = PatikaDay.StartOf(DateTimeOffset.UtcNow);
        var near = Post(author, 37.0010, 35.3213);
        var nearer = Post(author, 37.0001, 35.3213);
        var far = Post(author, 37.0300, 35.3213);
        var closed = Post(author, 37.0002, 35.3213) with { State = UrgentPostState.Closed };
        foreach (var post in new[] { near, nearer, far, closed })
        {
            Assert.True(await store.TryCreateAsync(post, start, 100, Ct));
        }

        var found = await store.NearAsync(new GeoPoint(35.3213, 37.0), 2000, 100, Ct);

        Assert.Equal([nearer.Id, near.Id], found.Select(p => p.Id));
        Assert.InRange(found[1].DistanceMeters!.Value, 100, 120);
    }

    [Fact]
    public async Task TokensMoveOnlyWithTheirInstallationAndAreCappedPerUser()
    {
        var first = await database.CreateUserAsync(Ct);
        var second = await database.CreateUserAsync(Ct);
        var attacker = await database.CreateUserAsync(Ct);
        var shared = "fcm-shared-" + Guid.NewGuid().ToString("N");
        var installation = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await using (var db = database.CreateContext())
        {
            var store = new EfDeviceStore(db);
            Assert.Equal(DeviceRegistration.Registered,
                await store.RegisterAsync(first, installation, shared, StoreEnvironment.Production, now, 10, Ct));
            Assert.Equal(DeviceRegistration.TokenInUse,
                await store.RegisterAsync(attacker, Guid.NewGuid(), shared, StoreEnvironment.Production, now, 10, Ct));
            Assert.Equal(DeviceRegistration.Registered,
                await store.RegisterAsync(second, installation, shared, StoreEnvironment.Sandbox, now.AddMinutes(1), 10, Ct));
            for (var i = 0; i < 12; i++)
            {
                await store.RegisterAsync(first, Guid.NewGuid(), $"fcm-first-{i:D2}-{Guid.NewGuid():N}", StoreEnvironment.Production,
                    now.AddMinutes(i), 10, Ct);
            }

            await store.UnregisterAsync(first, shared, Ct);
        }

        await using var check = database.CreateContext();
        var holder = await check.DeviceTokens.Where(d => d.Token == shared).Select(d => new { d.UserId, d.InstallationId }).SingleAsync(Ct);
        Assert.Equal((second, installation), (holder.UserId, holder.InstallationId));
        Assert.False(await check.DeviceTokens.AnyAsync(d => d.UserId == attacker, Ct));
        var firstTokens = await check.DeviceTokens.Where(d => d.UserId == first).Select(d => d.Token).ToListAsync(Ct);
        Assert.Equal(10, firstTokens.Count);
        Assert.DoesNotContain(firstTokens, t => t.StartsWith("fcm-first-00-", StringComparison.Ordinal));
        Assert.DoesNotContain(firstTokens, t => t.StartsWith("fcm-first-01-", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ConcurrentRegistrationsNeverExceedTenDevicesPerUser()
    {
        var userId = await database.CreateUserAsync(Ct);
        var now = DateTimeOffset.UtcNow;
        var outcomes = await Task.WhenAll(Enumerable.Range(0, 30).Select(async i =>
        {
            await using var db = database.CreateContext();
            return await new EfDeviceStore(db).RegisterAsync(userId, Guid.NewGuid(), $"fcm-burst-{i:D2}-{Guid.NewGuid():N}",
                StoreEnvironment.Production, now.AddSeconds(i), DeviceRules.MaxDevicesPerUser, Ct);
        }));

        Assert.All(outcomes, o => Assert.Equal(DeviceRegistration.Registered, o));
        await using var check = database.CreateContext();
        Assert.Equal(10, await check.DeviceTokens.CountAsync(d => d.UserId == userId, Ct));
    }

    [Fact]
    public async Task ConcurrentTakeoverAttemptsLeaveTheTokenWithItsInstallation()
    {
        var owner = await database.CreateUserAsync(Ct);
        var token = "fcm-contested-" + Guid.NewGuid().ToString("N");
        var installation = Guid.NewGuid();
        await using (var db = database.CreateContext())
        {
            await new EfDeviceStore(db).RegisterAsync(owner, installation, token, StoreEnvironment.Production, DateTimeOffset.UtcNow, 10, Ct);
        }

        var attackers = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => database.CreateUserAsync(Ct)));
        var outcomes = await Task.WhenAll(attackers.Select(async attacker =>
        {
            await using var db = database.CreateContext();
            return await new EfDeviceStore(db).RegisterAsync(attacker, Guid.NewGuid(), token, StoreEnvironment.Production,
                DateTimeOffset.UtcNow, 10, Ct);
        }));

        Assert.All(outcomes, o => Assert.Equal(DeviceRegistration.TokenInUse, o));
        await using var check = database.CreateContext();
        var holder = await check.DeviceTokens.Where(d => d.Token == token).Select(d => new { d.UserId, d.InstallationId }).SingleAsync(Ct);
        Assert.Equal((owner, installation), (holder.UserId, holder.InstallationId));
    }

    [Fact]
    public async Task UrgentSettingsStoreOnlyTheRoundedAreaAndOptOutErasesIt()
    {
        var userId = await database.CreateUserAsync(Ct);
        await using var db = database.CreateContext();
        var store = new EfDeviceStore(db);

        await store.SetUrgentSettingsAsync(userId, new UrgentSettings(true, new GeoPoint(28.979, 41.008), 1500), Ct);
        var saved = await store.GetUrgentSettingsAsync(userId, Ct);
        Assert.Equal(new UrgentSettings(true, new GeoPoint(28.979, 41.008), 1500), saved);

        await store.SetUrgentSettingsAsync(userId, new UrgentSettings(false, null, 1500), Ct);
        var cleared = await store.GetUrgentSettingsAsync(userId, Ct);
        Assert.Equal(new UrgentSettings(false, null, 1500), cleared);
        var homes = await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM users WHERE id = {userId} AND urgent_home IS NOT NULL").SingleAsync(Ct);
        Assert.Equal(0, homes);
    }

    private static UrgentPostRecord Post(Guid author, double lat, double lng) => new(
        Guid.CreateVersion7(), new GeoPoint(lng, lat), UrgentCategory.Injured, "Yaralı köpek, yol kenarında",
        MediaKeys.PhotoKey("urgent", Guid.CreateVersion7()), UrgentPostState.Open, author, 0, DateTimeOffset.UtcNow);
}
