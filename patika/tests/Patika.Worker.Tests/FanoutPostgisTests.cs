using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Worker.Jobs.Push;
using Xunit;

namespace Patika.Worker.Tests;

public sealed class FanoutPostgisTests(WorkerPostgisFixture database) : IClassFixture<WorkerPostgisFixture>
{
    private const double MetersPerDegreeLatitude = 111_320;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static double North(double latitude, double meters) => latitude + meters / MetersPerDegreeLatitude;

    private async Task<(Guid UserId, Guid DeviceId)> VolunteerAsync(
        double? homeLatitude, double longitude, bool optIn = true, int radius = 2000, bool deactivated = false,
        int lastSeenDaysAgo = 0, string? token = null)
    {
        await using var db = database.CreateContext();
        var user = new User
        {
            DisplayName = "Gönüllü",
            UrgentOptIn = optIn,
            UrgentRadiusM = radius,
            DeactivatedAt = deactivated ? DateTimeOffset.UtcNow : null,
        };
        var device = new DeviceToken
        {
            UserId = user.Id,
            InstallationId = Guid.NewGuid(),
            Token = token ?? "fcm-" + Guid.NewGuid().ToString("N"),
            Environment = StoreEnvironment.Production,
            LastSeenAt = DateTimeOffset.UtcNow.AddDays(-lastSeenDaysAgo),
        };
        db.Users.Add(user);
        db.DeviceTokens.Add(device);
        await db.SaveChangesAsync(Ct);
        if (homeLatitude is { } lat)
        {
            await db.Database.ExecuteSqlAsync(
                $"UPDATE users SET urgent_home = ST_SetSRID(ST_MakePoint({longitude}, {lat}), 4326)::geography WHERE id = {user.Id}", Ct);
        }

        return (user.Id, device.Id);
    }

    [Fact]
    public async Task RecipientsAreOptedInSavedAreasWithin2KmOnly()
    {
        const double lat = 41.0082;
        const double lng = 28.9784;
        var inside = await VolunteerAsync(North(lat, 1900), lng);
        await VolunteerAsync(North(lat, 2100), lng);
        await VolunteerAsync(North(lat, 100), lng, optIn: false);
        await VolunteerAsync(North(lat, 100), lng, deactivated: true);
        await VolunteerAsync(null, lng);
        await VolunteerAsync(North(lat, 1500), lng, radius: 1000);
        await VolunteerAsync(North(lat, 100), lng, lastSeenDaysAgo: 90);
        var author = await VolunteerAsync(North(lat, 50), lng);

        await using var db = database.CreateContext();
        var store = new PgUrgentFanoutStore(db);
        var post = new FanoutPost(Guid.CreateVersion7(), author.UserId, lat, lng, "Injured");
        var recipients = await store.RecipientsAsync(post, 2000, 500, DateTimeOffset.UtcNow.AddDays(-60), Ct);

        var only = Assert.Single(recipients);
        Assert.Equal(inside.DeviceId, only.DeviceId);
    }

    [Fact]
    public async Task RecipientsNeverExceed500AndAreTheNearest()
    {
        const double lat = 39.9334;
        const double lng = 32.8597;
        var devices = new List<Guid>();
        for (var i = 0; i < 600; i++)
        {
            devices.Add((await VolunteerAsync(North(lat, 10 + i * 2), lng)).DeviceId);
        }

        await using var db = database.CreateContext();
        var store = new PgUrgentFanoutStore(db);
        var post = new FanoutPost(Guid.CreateVersion7(), Guid.CreateVersion7(), lat, lng, "Trapped");
        var recipients = await store.RecipientsAsync(post, 2000, 500, DateTimeOffset.UtcNow.AddDays(-60), Ct);

        Assert.Equal(500, recipients.Count);
        Assert.Equal(devices.Take(500).ToHashSet(), recipients.Select(r => r.DeviceId).ToHashSet());
    }

    [Fact]
    public async Task FanoutClaimsEachPostOncePushesAtMost500AndPrunesDeadTokens()
    {
        const double lat = 38.4237;
        const double lng = 27.1428;
        for (var i = 0; i < 520; i++)
        {
            await VolunteerAsync(North(lat, 20 + i), lng, token: i == 0 ? "fcm-dead-token-izmir-0000000000000" : null);
        }

        var author = (await VolunteerAsync(null, lng, optIn: false)).UserId;
        Guid open, closed, old;
        await using (var db = database.CreateContext())
        {
            UrgentPost Post(UrgentPostState state) => new()
            {
                Location = new GeoPoint(lng, lat),
                Category = UrgentCategory.Injured,
                Description = "Yaralı bir kedi, sol arka bacağı",
                PhotoKey = "urgent/" + Guid.CreateVersion7().ToString("D"),
                State = state,
                CreatedBy = author,
            };
            var posts = new[] { Post(UrgentPostState.Open), Post(UrgentPostState.Closed), Post(UrgentPostState.Open) };
            db.UrgentPosts.AddRange(posts);
            await db.SaveChangesAsync(Ct);
            (open, closed, old) = (posts[0].Id, posts[1].Id, posts[2].Id);
            await db.Database.ExecuteSqlAsync($"UPDATE urgent_posts SET created_at = now() - interval '3 hours' WHERE id = {old}", Ct);
        }

        var sender = new FakePushSender();
        sender.Invalid.Add("fcm-dead-token-izmir-0000000000000");

        var first = await RunFanoutAsync(sender);
        var second = await RunFanoutAsync(sender);

        var summary = Assert.Single(first);
        Assert.Equal(open, summary.PostId);
        Assert.Equal(500, summary.Recipients);
        Assert.Equal(499, summary.Sent);
        Assert.Equal(1, summary.InvalidTokens);
        Assert.Empty(second);
        Assert.Equal(499, sender.Sent.Count);

        await using var check = database.CreateContext();
        Assert.Equal(499, await check.UrgentPosts.Where(p => p.Id == open).Select(p => p.NotifiedCount).SingleAsync(Ct));
        Assert.False(await check.DeviceTokens.AnyAsync(d => d.Token == "fcm-dead-token-izmir-0000000000000", Ct));
        var unclaimed = await check.Database.SqlQuery<int>(
            $"SELECT count(*)::int AS \"Value\" FROM urgent_posts WHERE id IN ({closed}, {old}) AND fanout_at IS NULL").SingleAsync(Ct);
        Assert.Equal(2, unclaimed);
    }

    [Fact]
    public async Task HiddenPostsAreNeverClaimedForFanout()
    {
        var author = (await VolunteerAsync(null, 29.0, optIn: false)).UserId;
        Guid visible, hidden;
        await using (var db = database.CreateContext())
        {
            UrgentPost Post(DateTimeOffset? hiddenAt) => new()
            {
                Location = new GeoPoint(29.0, 41.0),
                Category = UrgentCategory.Injured,
                Description = "Yaralı bir köpek, ön bacağı",
                PhotoKey = "urgent/" + Guid.CreateVersion7().ToString("D"),
                State = UrgentPostState.Open,
                CreatedBy = author,
                HiddenAt = hiddenAt,
                HiddenReason = hiddenAt is null ? null : "Uygunsuz fotoğraf",
            };
            var posts = new[] { Post(null), Post(DateTimeOffset.UtcNow) };
            db.UrgentPosts.AddRange(posts);
            await db.SaveChangesAsync(Ct);
            (visible, hidden) = (posts[0].Id, posts[1].Id);
        }

        await using var claim = database.CreateContext();
        var claimed = await new PgUrgentFanoutStore(claim).ClaimAsync(
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(-1), 100, Ct);

        Assert.Contains(claimed, p => p.Id == visible);
        Assert.DoesNotContain(claimed, p => p.Id == hidden);
        var unclaimed = await claim.Database.SqlQuery<int>(
            $"SELECT count(*)::int AS \"Value\" FROM urgent_posts WHERE id = {hidden} AND fanout_at IS NULL").SingleAsync(Ct);
        Assert.Equal(1, unclaimed);
    }

    [Fact]
    public async Task ConcurrentReservationsNeverOverrunTheDailyCounter()
    {
        var day = new DateOnly(2026, 10, 25);
        var grants = await Task.WhenAll(Enumerable.Range(0, 20).Select(async _ =>
        {
            await using var db = database.CreateContext();
            return await new PgPushCounterStore(db).ReserveAsync(day, "push-test", 50, 600, Ct);
        }));

        await using var check = database.CreateContext();
        var counters = new PgPushCounterStore(check);
        Assert.Equal(600, grants.Sum());
        Assert.Equal(600, await counters.CountAsync(day, "push-test", Ct));
        Assert.Equal(0, await counters.ReserveAsync(day, "push-test", 1, 600, Ct));
        await counters.ReleaseAsync(day, "push-test", 10, Ct);
        Assert.Equal(10, await counters.ReserveAsync(day, "push-test", 25, 600, Ct));
    }

    private async Task<IReadOnlyList<FanoutSummary>> RunFanoutAsync(IPushSender sender)
    {
        await using var db = database.CreateContext();
        var settings = Options.Create(new PushSettings());
        var clock = TimeProvider.System;
        var fanout = new UrgentFanout(new PgUrgentFanoutStore(db), sender,
            new PushCostGuard(new PgPushCounterStore(db), settings, clock), settings, clock, NullLogger<UrgentFanout>.Instance);
        return await fanout.RunOnceAsync(Ct);
    }
}
