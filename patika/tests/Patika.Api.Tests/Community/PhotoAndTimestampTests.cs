using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Patika.Api.Features.Adoptions;
using Patika.Api.Features.Animals;
using Patika.Api.Features.Media;
using Patika.Api.Features.Stations;
using Patika.Api.Features.Urgent;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Adoptions;
using Patika.Contracts.Community;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace Patika.Api.Tests.Community;

public sealed class PhotoAndTimestampTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData(null, true)]
    [InlineData(0, true)]
    [InlineData(-4320, true)]
    [InlineData(-4321, false)]
    [InlineData(1, true)]
    [InlineData(2, false)]
    public void OfflineTimestampWindowIsValidatedForBothRequests(int? minutes, bool valid)
    {
        DateTimeOffset? timestamp = minutes.HasValue ? Now.AddMinutes(minutes.Value) : null;
        var clock = new Clock(Now);
        Assert.Equal(valid, new FeedingRequestValidator(clock).Validate(new FeedingRequest(ClientCreatedAt: timestamp)).IsValid);
        Assert.Equal(valid, new SightingRequestValidator(clock).Validate(new SightingRequest(ClientCreatedAt: timestamp)).IsValid);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("invalid")]
    [InlineData("station/10000000-0000-0000-0000-000000000001")]
    public void StationDetailResolvesPhotoOrReturnsNull(string? key)
    {
        using var photos = Resolver();
        var station = new Station { PhotoKey = key!, Location = new GeoPoint(29, 41) };
        var response = StationEndpoints.Response(station, photos);
        if (key?.StartsWith("station/", StringComparison.Ordinal) == true)
            Assert.Equal(photos.Resolve(key, PhotoSize.Medium), Assert.IsType<string>(response.PhotoUrl));
        else
            Assert.Null(response.PhotoUrl);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("invalid")]
    [InlineData("urgent/10000000-0000-0000-0000-000000000001")]
    public void UrgentResponsesResolveDetailAndListSizes(string? key)
    {
        using var photos = Resolver();
        var post = new UrgentPostRecord(Guid.NewGuid(), new GeoPoint(29, 41), UrgentCategory.Injured,
            "Injured animal", key!, UrgentPostState.Open, Guid.NewGuid(), 0, Now);
        var detail = UrgentEndpoints.ToResponse(post, photos);
        var list = UrgentEndpoints.ToResponse(post, photos, PhotoSize.Thumbnail);
        if (key?.StartsWith("urgent/", StringComparison.Ordinal) == true)
        {
            Assert.Equal(photos.Resolve(key, PhotoSize.Medium), Assert.IsType<string>(detail.PhotoUrl));
            Assert.Equal(photos.Resolve(key, PhotoSize.Thumbnail), Assert.IsType<string>(list.PhotoUrl));
            Assert.NotEqual(detail.PhotoUrl, list.PhotoUrl);
        }
        else
        {
            Assert.Null(detail.PhotoUrl);
            Assert.Null(list.PhotoUrl);
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("invalid")]
    [InlineData("animal/10000000-0000-0000-0000-000000000001")]
    public async Task DockerReadResponsesIncludeResolvedUrls(string? key)
    {
        await using var server = new PostgreSqlBuilder("postgis/postgis:17-3.5").Build();
        await server.StartAsync(Ct);
        await using var db = new PatikaDbContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql(server.GetConnectionString(), pg => pg.UseNetTopologySuite()).Options);
        await db.Database.EnsureCreatedAsync(Ct);
        using var photos = Resolver();
        var user = new User { DisplayName = "Deniz" };
        var station = new Station { CreatedBy = user.Id, PhotoKey = key ?? "invalid", Location = new GeoPoint(29, 41) };
        var animal = new Animal { CreatedBy = user.Id, Location = new GeoPoint(29, 41) };
        var post = new AdoptionPost
        {
            AnimalId = animal.Id,
            CreatedBy = user.Id,
            Description = "A home",
            Requirements = "Safe home",
            District = "Istanbul",
            State = AdoptionPostState.Published,
            ClosesAt = DateTimeOffset.UtcNow.AddDays(1)
        };
        db.AddRange(user, station, animal, post, new Feeding { StationId = station.Id, UserId = user.Id, At = Now, PhotoKey = key });
        if (key is not null)
            db.Add(new AnimalPhoto { AnimalId = animal.Id, CreatedBy = user.Id, Key = key, ModerationState = ModerationState.Approved });
        await db.SaveChangesAsync(Ct);

        var feedings = Value<PageResponse<FeedingResponse>>(await StationEndpoints.FeedingsAsync(station.Id, new PageQuery(), db, Ct, photos: photos));
        Assert.Equal(photos.Resolve(key, PhotoSize.Thumbnail), Assert.Single(feedings.Items).PhotoUrl);
        var animalPhotos = Value<PageResponse<AnimalPhotoResponse>>(await AnimalEndpoints.PhotosAsync(animal.Id, new PageQuery(), db, Ct, photos));
        if (key is not null)
            Assert.Equal(photos.Resolve(key, PhotoSize.Thumbnail), Assert.Single(animalPhotos.Items).PhotoUrl);
        else
            Assert.Empty(animalPhotos.Items);
        var list = Value<AdoptionPostResponse[]>(await AdoptionEndpoints.List(db, null, null, ct: Ct, photos: photos));
        var detail = Value<AdoptionPostResponse>(await AdoptionEndpoints.Get(post.Id, Http(user.Id), db, Ct, photos));
        Assert.Equal(photos.Resolve(key, PhotoSize.Thumbnail), Assert.Single(list).FirstPhotoUrl);
        Assert.Equal(photos.Resolve(key, PhotoSize.Medium), detail.FirstPhotoUrl);
        if (key?.StartsWith("animal/", StringComparison.Ordinal) == true)
        {
            Assert.NotNull(detail.FirstPhotoUrl);
            Assert.NotNull(Assert.Single(animalPhotos.Items).PhotoUrl);
            Assert.NotNull(Assert.Single(feedings.Items).PhotoUrl);
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData(-120)]
    [InlineData(1)]
    public async Task DockerOfflineWritesStoreEventTimeAndEnforceServerCooldown(int? minutes)
    {
        await using var server = new PostgreSqlBuilder("postgis/postgis:17-3.5").Build();
        await server.StartAsync(Ct);
        await using var db = new PatikaDbContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql(server.GetConnectionString(), pg => pg.UseNetTopologySuite()).Options);
        await db.Database.EnsureCreatedAsync(Ct);
        var user = new User { DisplayName = "Deniz" };
        var station = new Station { CreatedBy = user.Id, PhotoKey = "invalid", Location = new GeoPoint(29, 41) };
        var animal = new Animal { CreatedBy = user.Id, Location = new GeoPoint(29, 41) };
        db.AddRange(user, station, animal);
        await db.SaveChangesAsync(Ct);
        var receiptTime = DateTimeOffset.UtcNow;
        receiptTime = receiptTime.AddTicks(-(receiptTime.Ticks % TimeSpan.TicksPerMicrosecond));
        DateTimeOffset? timestamp = minutes.HasValue ? receiptTime.AddMinutes(minutes.Value) : null;
        var expected = minutes < 0 ? timestamp!.Value : receiptTime;
        var http = Http(user.Id);
        var clock = new Clock(receiptTime);
        var feeding = Value<FeedingResponse>(await StationEndpoints.FeedAsync(station.Id,
            new FeedingRequest(ClientCreatedAt: timestamp), http, db, clock, Ct));
        var sighting = Value<SightingResponse>(await AnimalEndpoints.SightingAsync(animal.Id,
            new SightingRequest(ClientCreatedAt: timestamp), http, db, clock, Ct));
        Assert.Equal(expected, feeding.At);
        Assert.Equal(expected, sighting.At);
        db.ChangeTracker.Clear();
        Assert.Equal(expected, (await db.Feedings.SingleAsync(Ct)).At);
        var stored = await db.Feedings.SingleAsync(Ct);
        Assert.InRange(stored.CreatedAt, receiptTime, DateTimeOffset.UtcNow);
        Assert.Equal(expected, (await db.Sightings.SingleAsync(Ct)).At);
        var result = await StationEndpoints.FeedAsync(station.Id,
            new FeedingRequest(ClientCreatedAt: receiptTime.AddHours(-48)), http, db, new Clock(stored.CreatedAt), Ct);
        Assert.Equal(409, Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode);
        Assert.Equal("1800", http.Response.Headers.RetryAfter.ToString());
    }

    private static PhotoUrlResolver Resolver() => new(
        Options.Create(new StorageSettings { PublicBaseUrl = "https://photos.example" }),
        Options.Create(new MediaSettings()), new Clock(Now));

    private static T Value<T>(IResult result) =>
        Assert.IsType<T>(Assert.IsAssignableFrom<IValueHttpResult>(result).Value);

    private static DefaultHttpContext Http(Guid id) => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(PatikaClaims.Subject, id.ToString()), new Claim(PatikaClaims.Role, "User")], "test"))
    };

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
