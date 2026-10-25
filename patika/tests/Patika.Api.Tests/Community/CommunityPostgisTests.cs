using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Patika.Api.Features.Animals;
using Patika.Api.Features.Stations;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Community;
using Patika.Domain;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Api.Tests.Community;

public sealed class CommunityPostgisTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task GridClusteringFiltersAndPaginatesInPostgis()
    {
        await using var database = new PostgisFixture();
        await database.InitializeAsync();
        await using var db = database.CreateContext();
        var user = new User { DisplayName = "Deniz" };
        db.Users.Add(user);
        for (var i = 0; i < 3; i++)
        {
            db.Stations.Add(new Station { CreatedBy = user.Id, Location = new GeoPoint(28.97 + i * 0.001, 41.01), Kind = StationKind.Food, PhotoKey = "station/a.jpg" });
            db.Animals.Add(new Animal { CreatedBy = user.Id, Location = new GeoPoint(28.97 + i * 0.001, 41.01), Species = Species.Cat });
        }
        db.Stations.Add(new Station { CreatedBy = user.Id, Location = new GeoPoint(28.97, 41.01), Status = StationStatus.Removed, PhotoKey = "station/b.jpg" });
        await db.SaveChangesAsync(Ct);
        var query = new MapQuery { Bbox = "28.96,41,28.98,41.02", Zoom = 0 };
        var clustered = await CommunityMap.StationsAsync(db, query, Ct);
        Assert.Equal(3, Assert.Single(clustered.Items).Count);
        Assert.Null(clustered.Items[0].Id);
        Assert.Equal(3, Assert.Single((await CommunityMap.AnimalsAsync(db, query, Ct)).Items).Count);
        query.Zoom = 22;
        query.PageSize = 2;
        var first = await CommunityMap.StationsAsync(db, query, Ct);
        Assert.True(first.HasMore);
        Assert.All(first.Items, x => Assert.Equal(1, x.Count));
        query.Page = 2;
        var second = await CommunityMap.StationsAsync(db, query, Ct);
        Assert.False(second.HasMore);
        Assert.Single(second.Items);
        Assert.DoesNotContain(second.Items[0].Id, first.Items.Select(x => x.Id));
        query.Page = 1;
        query.Kind = "Water";
        Assert.Empty((await CommunityMap.StationsAsync(db, query, Ct)).Items);
    }

    [Fact]
    public async Task ConcurrentFeedingsEnforceCooldownAndClearRefillAtomically()
    {
        await using var database = new PostgisFixture();
        await database.InitializeAsync();
        var user = new User { DisplayName = "Deniz" };
        var other = new User { DisplayName = "Ekin" };
        var station = new Station { CreatedBy = user.Id, Location = new GeoPoint(29, 41), PhotoKey = "station/a.jpg", Status = StationStatus.NeedsRefill };
        await using (var seed = database.CreateContext())
        {
            seed.AddRange(user, other, station);
            await seed.SaveChangesAsync(Ct);
        }
        var clock = new FixedClock(DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
        async Task<int?> Feed(Guid actor)
        {
            await using var context = database.CreateContext();
            var result = await StationEndpoints.FeedAsync(station.Id, new FeedingRequest(Note: "Mama bırakıldı"), Http(actor), context, clock, Ct);
            return ((IStatusCodeHttpResult)result).StatusCode;
        }
        var statuses = await Task.WhenAll(Feed(user.Id), Feed(user.Id));
        Assert.Equal(new int?[] { 201, 409 }, statuses.Order().ToArray());
        Assert.Equal(201, await Feed(other.Id));
        clock.Now = clock.Now.AddMinutes(30);
        Assert.Equal(201, await Feed(user.Id));
        await using var verify = database.CreateContext();
        var saved = await verify.Stations.SingleAsync(x => x.Id == station.Id, Ct);
        Assert.Equal(3, saved.FeedingsCount);
        Assert.Equal(3, await verify.Feedings.CountAsync(Ct));
        Assert.Equal(StationStatus.Active, saved.Status);
        Assert.Equal(clock.Now, saved.LastFedAt);
    }

    [Fact]
    public async Task FollowsAreIdempotentAndIsolatedAndPhotosRemainPending()
    {
        await using var database = new PostgisFixture();
        await database.InitializeAsync();
        var user = new User { DisplayName = "Deniz" };
        var other = new User { DisplayName = "Ekin" };
        var animal = new Animal { CreatedBy = user.Id, Location = new GeoPoint(29, 41) };
        await using (var seed = database.CreateContext())
        {
            seed.AddRange(user, other, animal);
            seed.Follows.Add(new Follow { AnimalId = animal.Id, UserId = other.Id });
            await seed.SaveChangesAsync(Ct);
        }
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthorization();
        services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();
        await using var provider = services.BuildServiceProvider();
        var authorization = provider.GetRequiredService<IAuthorizationService>();
        async Task Follow()
        {
            await using var context = database.CreateContext();
            await AnimalEndpoints.FollowAsync(animal.Id, Http(user.Id), context, authorization, Ct);
        }
        await Task.WhenAll(Follow(), Follow());
        await using var db = database.CreateContext();
        Assert.Equal(2, await db.Follows.CountAsync(Ct));
        await AnimalEndpoints.UnfollowAsync(animal.Id, Http(user.Id), db, authorization, Ct);
        Assert.Equal(other.Id, (await db.Follows.SingleAsync(Ct)).UserId);
        var clock = new FixedClock(DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
        await AnimalEndpoints.SightingAsync(animal.Id, new SightingRequest("Bugün görüldü"), Http(user.Id), db, clock, Ct);
        Assert.Equal(user.Id, (await db.Sightings.SingleAsync(Ct)).UserId);
        await AnimalEndpoints.PhotoAsync(animal.Id, new AnimalPhotoRequest("animal/a.jpg"), Http(user.Id), db, Ct);
        Assert.Equal(ModerationState.Pending, (await db.AnimalPhotos.SingleAsync(Ct)).ModerationState);
    }

    private static DefaultHttpContext Http(Guid id) => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(PatikaClaims.Subject, id.ToString()), new Claim(PatikaClaims.Role, "User")], "test"))
    };

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
