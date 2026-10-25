using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Media;
using Patika.Infrastructure.Persistence;
using Patika.Web.Services.PublicQueries;
using Xunit;

namespace Patika.Web.Tests;

public sealed class PublicQueryTests(PostgisFixture database) : IClassFixture<PostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static IConfiguration Configuration(bool samples = false) => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Web:ShowSamples"] = samples.ToString() }).Build();
    private static PhotoUrlResolver Photos() => new(Options.Create(new StorageSettings { PublicBaseUrl = "https://media.example.org" }),
        Options.Create(new MediaSettings()), new FixedClock());

    [Fact]
    public async Task MigrationSeedsDistrictsBackfillsTextAndUniqueSlugs()
    {
        await using var db = database.CreateContext();
        Assert.Equal(39, await db.Districts.CountAsync(Ct));
        var district = await db.Districts.SingleAsync(d => d.Slug == "kadikoy", Ct);
        Assert.Equal(district.Id, (await db.Stations.SingleAsync(s => s.Id == PostgisFixture.StationId, Ct)).DistrictId);
        Assert.Equal(district.Id, (await db.Animals.SingleAsync(a => a.Id == PostgisFixture.AnimalId, Ct)).DistrictId);
        var post = await db.AdoptionPosts.SingleAsync(p => p.Id == PostgisFixture.PostId, Ct);
        Assert.Equal(district.Id, post.DistrictId);
        Assert.Equal("pamuk-kadikoy-400000", post.Slug);
        Assert.Null(post.ClosedReason);
        Assert.Equal(new[] { "klinik", "klinik-2" }, await db.CarePlaces.Where(p => p.Name == "Klinik").OrderBy(p => p.Slug).Select(p => p.Slug).ToArrayAsync(Ct));
        Assert.Equal(district.Id, await new DistrictResolver(db).ResolveAsync(" KADIKÖY! ", Ct));
        Assert.Null(await new DistrictResolver(db).ResolveAsync("Unknown", Ct));
    }

    [Fact]
    public async Task AdoptionQueriesFilterVisibilityAndPhotosAndPageSize()
    {
        await using var db = database.CreateContext();
        var district = await db.Districts.SingleAsync(d => d.Slug == "kadikoy", Ct);
        var animal = new Animal { CreatedBy = PostgisFixture.UserId, Name = "Test", Location = new GeoPoint(29, 41), BirthYear = 2020 };
        db.Animals.Add(animal);
        db.AdoptionPosts.AddRange(
            new AdoptionPost { AnimalId = animal.Id, CreatedBy = PostgisFixture.UserId, Description = "Expired", Requirements = "Home", District = "Kadıköy", State = AdoptionPostState.Published, ClosesAt = PostgisFixture.Now.AddDays(-1) },
            new AdoptionPost { AnimalId = animal.Id, CreatedBy = PostgisFixture.UserId, Description = "Pending", Requirements = "Home", District = "Kadıköy", State = AdoptionPostState.Pending, ClosesAt = PostgisFixture.Now.AddDays(1) });
        var approved = new AnimalPhoto { AnimalId = PostgisFixture.AnimalId, CreatedBy = PostgisFixture.UserId, Key = "animal/60000000-0000-0000-0000-000000000001", ModerationState = ModerationState.Approved };
        db.AnimalPhotos.AddRange(approved, new AnimalPhoto { AnimalId = PostgisFixture.AnimalId, CreatedBy = PostgisFixture.UserId, Key = "animal/60000000-0000-0000-0000-000000000002", ModerationState = ModerationState.Pending });
        await db.SaveChangesAsync(Ct);
        using var photos = Photos();
        var queries = new AdoptionQueries(db, photos, new FixedClock());
        var card = Assert.Single(await queries.ListAsync("istanbul", "kadikoy", Species.Cat, ct: Ct));
        Assert.Equal("Pamuk", card.AnimalName);
        Assert.Equal("Kadıköy", card.DistrictName);
        Assert.Contains("_320.webp", card.ThumbUrl, StringComparison.Ordinal);
        var detail = await queries.GetBySlugAsync(card.Slug, Ct);
        Assert.NotNull(detail);
        Assert.Single(detail.Photos);
        Assert.Equal("Description", detail.Description);
        Assert.Null(await queries.GetBySlugAsync("missing", Ct));
        Assert.Empty(await queries.ListAsync(provinceSlug: "unknown", ct: Ct));
        Assert.Empty(await queries.ListAsync(species: Species.Dog, ct: Ct));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => queries.ListAsync(pageSize: 25, ct: Ct));
        Assert.Empty(db.ChangeTracker.Entries<Province>());
    }

    [Fact]
    public async Task CarePlaceSamplesAndFiltersAndSlugCollisions()
    {
        await using var db = database.CreateContext();
        var name = "Clinic " + Guid.NewGuid().ToString("N");
        var first = new CarePlace { Name = name, Address = "Street", District = "Üsküdar", Location = new GeoPoint(29, 41), Open24h = true, Website = "https://example.org" };
        var second = new CarePlace { Name = name, Address = "Street", District = "Üsküdar", Location = new GeoPoint(29, 41) };
        var sample = new CarePlace { Name = "[ÖRNEK] " + name, Address = "Street", District = "Üsküdar", Location = new GeoPoint(29, 41), IsSample = true };
        db.AddRange(first, second, sample);
        await db.SaveChangesAsync(Ct);
        Assert.Equal(first.Slug + "-2", second.Slug);
        var queries = new CarePlaceQueries(db, Configuration());
        Assert.Null(await queries.GetBySlugAsync(sample.Slug, Ct));
        Assert.NotNull(await new CarePlaceQueries(db, Configuration(true)).GetBySlugAsync(sample.Slug, Ct));
        var row = Assert.Single(await queries.ListAsync(open24h: true, districtSlug: "uskudar", ct: Ct));
        Assert.Equal(first.Slug, row.Slug);
        Assert.Equal("https://example.org", row.Website);
        Assert.Empty(await queries.ListAsync(kind: CarePlaceKind.Shelter, districtSlug: "uskudar", ct: Ct));
    }

    [Fact]
    public async Task DistrictAndSitemapReturnOnlyPublicData()
    {
        await using var db = database.CreateContext();
        using var photos = Photos();
        var adoptions = new AdoptionQueries(db, photos, new FixedClock());
        var queries = new PlaceQueries(db, adoptions, new CarePlaceQueries(db, Configuration()), photos, new FixedClock());
        Assert.Single(await queries.ListProvincesAsync(Ct));
        Assert.Null(await queries.GetDistrictAsync("unknown", "kadikoy", Ct));
        var district = await queries.GetDistrictAsync("istanbul", "kadikoy", Ct);
        Assert.NotNull(district);
        Assert.Equal(1, district.ActiveStations);
        Assert.Equal(1, district.OpenAdoptions);
        Assert.Equal(2, district.FeedingsLastSevenDays);
        var station = Assert.Single(district.Stations);
        Assert.Equal("İsimsiz istasyon", station.Name);
        Assert.Equal(LastFedBucket.Never, station.LastFed);
        Assert.Equal(41.123, station.Latitude);
        Assert.Equal(29.123, station.Longitude);
        var sitemap = new SitemapQueries(db, Configuration(), new FixedClock());
        var entries = await sitemap.ListAsync(ct: Ct);
        Assert.Contains(entries, e => e.Url == "/istasyonlar/istanbul/kadikoy");
        Assert.Contains(entries, e => e.Url.StartsWith("/sahiplendirme/", StringComparison.Ordinal));
        Assert.DoesNotContain(entries, e => e.Url.Contains("ornek", StringComparison.Ordinal));
        Assert.Empty(await sitemap.ListAsync(2, Ct));
    }

    [Fact]
    public async Task ImpactUsesFourCompleteIstanbulWeeksAndAdoptionOutcomeTime()
    {
        await using var db = database.CreateContext();
        var queries = new ImpactQueries(db, new FixedClock());
        var impact = await queries.GetAsync(Ct);
        Assert.Equal(4, impact.Weeks.Count);
        Assert.Equal(new DateOnly(2026, 9, 21), impact.Weeks[0].StartsOn);
        Assert.Equal(new DateOnly(2026, 10, 12), impact.LastWeek.StartsOn);
        Assert.All(impact.Weeks, week => Assert.Equal(DayOfWeek.Monday, week.StartsOn.DayOfWeek));
        Assert.Equal(1, impact.LastWeek.Feedings);
        Assert.Equal(1, impact.LastWeek.NewStations);
        Assert.Equal(1, impact.LastWeek.Adoptions);
        Assert.Equal(1, impact.LastWeek.UrgentPostsHandled);
        Assert.Equal(ImpactQueries.MethodNote, impact.MethodNote);
    }
}
