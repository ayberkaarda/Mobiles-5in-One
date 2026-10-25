using System.Net;
using System.Text.Json;
using Patika.Api.Features.Account;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Patika.Domain;
using Patika.Domain.Entities;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests.Account;

public sealed class MeStatsTests : IAsyncLifetime
{
    private readonly PatikaApiFactory factory = new();

    public ValueTask InitializeAsync() => ValueTask.CompletedTask;

    public async ValueTask DisposeAsync() => await factory.DisposeAsync();

    [Fact]
    public async Task MeCarriesFeedingCountBadgesAndJoinDate()
    {
        using var client = factory.CreateApiClient("198.51.100.30");
        var email = NewEmail();
        var tokens = await client.RegisterAsync(factory, email);
        var user = factory.Store.Users.Single(u => u.Email == email);
        var joined = new DateTimeOffset(2026, 9, 1, 8, 30, 0, TimeSpan.Zero);
        factory.Stats.Set(user.Id, feedings: 12, sightings: 1, adoptionsHelped: 0, joinedAt: joined);

        using var response = await client.GetMeAsync(tokens.AccessToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.ReadJsonAsync();
        Assert.Equal(12, json.GetProperty("feedingCount").GetInt32());
        Assert.Equal(["first_feeding", "feedings_10", "first_sighting"],
            json.GetProperty("badges").EnumerateArray().Select(b => b.GetString()!).ToArray());
        Assert.Equal(joined, json.GetProperty("joinedAt").GetDateTimeOffset());
        var me = json.Deserialize<MeResponse>();
        Assert.Equal(email, me!.Email);
        Assert.Equal(12, me.FeedingCount);
    }

    [Fact]
    public async Task ANewAccountHasNoBadges()
    {
        using var client = factory.CreateApiClient("198.51.100.31");
        var tokens = await client.RegisterAsync(factory, NewEmail());

        using var response = await client.GetMeAsync(tokens.AccessToken);

        var json = await response.ReadJsonAsync();
        Assert.Equal(0, json.GetProperty("feedingCount").GetInt32());
        Assert.Equal(0, json.GetProperty("badges").GetArrayLength());
    }

    [Theory]
    [InlineData(0, 0, 0, new string[0])]
    [InlineData(1, 0, 0, new[] { "first_feeding" })]
    [InlineData(9, 0, 0, new[] { "first_feeding" })]
    [InlineData(10, 0, 0, new[] { "first_feeding", "feedings_10" })]
    [InlineData(49, 0, 0, new[] { "first_feeding", "feedings_10" })]
    [InlineData(50, 0, 0, new[] { "first_feeding", "feedings_10", "feedings_50" })]
    [InlineData(99, 0, 0, new[] { "first_feeding", "feedings_10", "feedings_50" })]
    [InlineData(100, 1, 1, new[] { "first_feeding", "feedings_10", "feedings_50", "feedings_100", "first_sighting", "first_adoption_helped" })]
    [InlineData(0, 3, 0, new[] { "first_sighting" })]
    [InlineData(0, 0, 2, new[] { "first_adoption_helped" })]
    public void BadgesFollowTheCounts(int feedings, int sightings, int adoptions, string[] expected) =>
        Assert.Equal(expected, new AccountStats(feedings, sightings, adoptions, DateTimeOffset.UnixEpoch).Badges());
}

/// <summary><see cref="EfAccountStatsReader"/> on PostGIS (random host port).</summary>
public sealed class EfAccountStatsTests(PostgisFixture database) : IClassFixture<PostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task CountsOnlyTheUsersOwnContributions()
    {
        await using var db = database.CreateContext();
        var me = new User { DisplayName = "Pamuk" };
        var other = new User { DisplayName = "Tarçın" };
        db.Users.AddRange(me, other);
        await db.SaveChangesAsync(Ct);
        var station = new Station { PhotoKey = $"station/{Guid.CreateVersion7():D}", CreatedBy = me.Id, Location = new GeoPoint(29.0, 41.0) };
        var adopted = new Animal { CreatedBy = other.Id, Location = new GeoPoint(29.0, 41.0), Status = AnimalStatus.Adopted };
        var waiting = new Animal { CreatedBy = me.Id, Location = new GeoPoint(29.0, 41.0) };
        db.AddRange(station, adopted, waiting);
        await db.SaveChangesAsync(Ct);
        var now = DateTimeOffset.UtcNow;
        db.Feedings.AddRange(Enumerable.Range(0, 12).Select(i => new Feeding { StationId = station.Id, UserId = me.Id, At = now.AddMinutes(-i) }));
        db.Feedings.AddRange(Enumerable.Range(0, 3).Select(i => new Feeding { StationId = station.Id, UserId = other.Id, At = now }));
        db.Sightings.Add(new Sighting { AnimalId = waiting.Id, UserId = me.Id, At = now });
        db.Sightings.Add(new Sighting { AnimalId = waiting.Id, UserId = other.Id, At = now });
        db.AdoptionPosts.AddRange(
            new AdoptionPost { AnimalId = adopted.Id, CreatedBy = me.Id, Description = "Sevimli", Requirements = "Ev", District = "Kadıköy" },
            new AdoptionPost { AnimalId = waiting.Id, CreatedBy = me.Id, Description = "Bekliyor", Requirements = "Ev", District = "Kadıköy" },
            new AdoptionPost { AnimalId = adopted.Id, CreatedBy = other.Id, Description = "Başkası", Requirements = "Ev", District = "Kadıköy" });
        await db.SaveChangesAsync(Ct);

        var stats = await new EfAccountStatsReader(db).ReadAsync(me.Id, Ct);

        Assert.NotNull(stats);
        Assert.Equal(12, stats.FeedingCount);
        Assert.Equal(1, stats.SightingCount);
        Assert.Equal(1, stats.AdoptionsHelped);
        Assert.Equal(me.CreatedAt.ToUnixTimeSeconds(), stats.JoinedAt.ToUnixTimeSeconds());
        Assert.Equal(["first_feeding", "feedings_10", "first_sighting", "first_adoption_helped"], stats.Badges());
        Assert.Null(await new EfAccountStatsReader(db).ReadAsync(Guid.CreateVersion7(), Ct));
    }
}
