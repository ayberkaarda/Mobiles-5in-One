using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Animals;
using Patika.Api.Features.Stations;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace Patika.Api.Tests.Community;

public sealed class ReadModelTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("/v1/me/follows")]
    [InlineData("/v1/me/adoption-requests")]
    [InlineData("/v1/me/urgent-posts")]
    public async Task PersonalListsRejectGuestsBeforeDatabaseAccess(string path)
    {
        await using var app = CommunityHttpTests.CreateApp();
        Patika.Api.Features.Urgent.UrgentEndpoints.MapUrgentEndpoints(app.MapGroup("/v1"));
        await app.StartAsync(Ct);
        using var client = app.GetTestClient();
        using var response = await client.GetAsync(path, Ct);
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("Kadıköy", true)]
    [InlineData("a\nb", false)]
    public void DistrictValidationAppliesToCreateAndUpdate(string? district, bool valid)
    {
        var point = new CoordinateDto(41, 29);
        Assert.Equal(valid, new StationRequestValidator().Validate(new StationRequest(point, "Food", "Cat", "station/a.jpg", District: district)).IsValid);
        Assert.Equal(valid, new StationUpdateRequestValidator().Validate(new StationUpdateRequest(District: district)).IsValid);
        Assert.Equal(valid, new AnimalRequestValidator().Validate(new AnimalRequest(point, "Cat", "Unknown", "Healthy", District: district)).IsValid);
        Assert.Equal(valid, new AnimalUpdateRequestValidator().Validate(new AnimalUpdateRequest(District: district)).IsValid);
    }

    [Fact]
    public void DistrictLengthIsLimitedOnAllWrites()
    {
        var district = new string('a', 61);
        var point = new CoordinateDto(41, 29);
        Assert.False(new StationRequestValidator().Validate(new StationRequest(point, "Food", "Cat", "station/a.jpg", District: district)).IsValid);
        Assert.False(new StationUpdateRequestValidator().Validate(new StationUpdateRequest(District: district)).IsValid);
        Assert.False(new AnimalRequestValidator().Validate(new AnimalRequest(point, "Cat", "Unknown", "Healthy", District: district)).IsValid);
        Assert.False(new AnimalUpdateRequestValidator().Validate(new AnimalUpdateRequest(District: district)).IsValid);
    }

    [Fact]
    public async Task AdoptionListAndDetailIncludeOnlyApprovedFirstPhotoAndAnimalHealth()
    {
        await using var server = new PostgreSqlBuilder("postgis/postgis:17-3.5").Build();
        await server.StartAsync(Ct);
        await using var db = new PatikaDbContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql(server.GetConnectionString(), pg => pg.UseNetTopologySuite()).Options);
        await db.Database.EnsureCreatedAsync(Ct);
        var user = new User { DisplayName = "Deniz" };
        var animal = new Animal
        {
            CreatedBy = user.Id,
            Name = "Pamuk",
            Species = Species.Cat,
            Status = AnimalStatus.Injured,
            Vaccinated = true,
            Sterilized = true,
            EarTagged = true,
            Location = new GeoPoint(29, 41)
        };
        var post = new AdoptionPost
        {
            AnimalId = animal.Id,
            CreatedBy = user.Id,
            Description = "Bir yuva arıyor",
            Requirements = "Güvenli yuva",
            District = "Kadıköy",
            State = AdoptionPostState.Published,
            ClosesAt = DateTimeOffset.UtcNow.AddDays(1)
        };
        db.AddRange(user, animal, post,
            new AnimalPhoto { AnimalId = animal.Id, CreatedBy = user.Id, Key = "animal/private.jpg", ModerationState = ModerationState.Pending },
            new AnimalPhoto { AnimalId = animal.Id, CreatedBy = user.Id, Key = "animal/first.jpg", ModerationState = ModerationState.Approved });
        await db.SaveChangesAsync(Ct);
        await using var app = CommunityHttpTests.CreateApp(server.GetConnectionString());
        await app.StartAsync(Ct);
        using var client = app.GetTestClient();
        var list = await client.GetFromJsonAsync<JsonElement>("/v1/adoptions", Ct);
        var detail = await client.GetFromJsonAsync<JsonElement>($"/v1/adoptions/{post.Id}", Ct);
        foreach (var item in new[] { list[0], detail })
        {
            Assert.Equal("Pamuk", item.GetProperty("animalName").GetString());
            Assert.Equal("Cat", item.GetProperty("species").GetString());
            Assert.Equal("Injured", item.GetProperty("status").GetString());
            Assert.True(item.GetProperty("sterilized").GetBoolean());
            Assert.True(item.GetProperty("vaccinated").GetBoolean());
            Assert.True(item.GetProperty("earTagged").GetBoolean());
            Assert.Equal("animal/first.jpg", item.GetProperty("firstPhotoKey").GetString());
        }
    }

    [Fact]
    public async Task FeedingIdentityCooldownAndStationFilterUseStoredData()
    {
        await using var server = new PostgreSqlBuilder("postgis/postgis:17-3.5").Build();
        await server.StartAsync(Ct);
        await using var db = new PatikaDbContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql(server.GetConnectionString(), pg => pg.UseNetTopologySuite()).Options);
        await db.Database.EnsureCreatedAsync(Ct);
        var user = new User { DisplayName = "Deniz", Email = "private@example.org" };
        var other = new User { DisplayName = " " };
        var station = new Station { CreatedBy = user.Id, PhotoKey = "station/a.jpg", Location = new GeoPoint(29, 41), District = "Kadıköy" };
        var animal = new Animal { CreatedBy = user.Id, StationId = station.Id, Location = new GeoPoint(29, 41), District = "Kadıköy" };
        var now = DateTimeOffset.UtcNow;
        db.AddRange(user, other, station, animal,
            new Animal { CreatedBy = user.Id, Location = new GeoPoint(29, 41) },
            new Feeding { StationId = station.Id, UserId = user.Id, At = now.AddSeconds(-30) },
            new Feeding { StationId = station.Id, UserId = other.Id, At = now.AddSeconds(-60) },
            new Feeding { StationId = station.Id, At = now.AddSeconds(-90) },
            new Follow { AnimalId = animal.Id, UserId = user.Id },
            new Follow { AnimalId = animal.Id, UserId = other.Id });
        await db.SaveChangesAsync(Ct);
        await db.Feedings.Where(f => f.StationId == station.Id && f.UserId == user.Id)
            .ExecuteUpdateAsync(set => set.SetProperty(f => f.CreatedAt, now.AddSeconds(-30)), Ct);
        var http = Http(user.Id);
        var page = Value<PageResponse<FeedingResponse>>(await StationEndpoints.FeedingsAsync(station.Id, new PageQuery(), db, Ct, http));
        Assert.True(page.Items[0].IsMine);
        Assert.Equal("Deniz", page.Items[0].AuthorDisplayName);
        Assert.All(page.Items.Skip(1), f => { Assert.False(f.IsMine); Assert.Equal("Gönüllü", f.AuthorDisplayName); });
        Assert.DoesNotContain(user.Email!, JsonSerializer.Serialize(page), StringComparison.Ordinal);
        var guest = Value<PageResponse<FeedingResponse>>(await StationEndpoints.FeedingsAsync(station.Id, new PageQuery(), db, Ct));
        Assert.All(guest.Items, f => Assert.False(f.IsMine));
        var cooldown = Assert.IsAssignableFrom<IValueHttpResult>(await StationEndpoints.FeedAsync(station.Id, new FeedingRequest(), http, db, new Clock(now), Ct));
        var problem = Assert.IsType<Microsoft.AspNetCore.Mvc.ProblemDetails>(cooldown.Value);
        Assert.Equal(409, problem.Status);
        Assert.Equal(1770, problem.Extensions["retryAfterSeconds"]);
        Assert.Equal("1770", http.Response.Headers.RetryAfter.ToString());
        var detail = Value<AnimalResponse>(await AnimalEndpoints.GetAsync(animal.Id, db, Ct, http));
        Assert.True(detail.IsFollowing);
        Assert.Equal(2, detail.FollowerCount);
        Assert.Equal("Kadıköy", detail.District);
        var map = await CommunityMap.AnimalsAsync(db, new MapQuery { Bbox = "28.99,40.99,29.01,41.01", StationId = station.Id }, Ct);
        Assert.Equal(animal.Id, Assert.Single(map.Items).Id);
    }

    private static T Value<T>(IResult result) => Assert.IsType<T>(Assert.IsAssignableFrom<IValueHttpResult>(result).Value);

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
