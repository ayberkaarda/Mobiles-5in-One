using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Patika.Api.Features.Adoptions;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Urgent;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests.Adoptions;

/// <summary>Two creates choosing the same slug at once: the loser retries with the next suffix.</summary>
public sealed class SlugRaceTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task TwoConcurrentCreatesOfTheSameNameAndDistrictBothSucceed()
    {
        var owner = await database.CreateUserAsync(Ct);
        for (var round = 0; round < 5; round++)
        {
            var name = $"İkiz {round}";
            var (statuses, slugs) = await CreateConcurrentlyAsync(owner, name, 2);
            Assert.All(statuses, status => Assert.Equal(201, status));
            Assert.Equal(2, slugs.Distinct(StringComparer.Ordinal).Count());
            Assert.All(slugs, slug => Assert.StartsWith($"ikiz-{round}-kadikoy-", slug, StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task AStormOfIdenticalCreatesNeverFailsWithAServerError()
    {
        // Eight at once can lose more than MaxAttempts times; those get the 409 problem and may retry.
        var owner = await database.CreateUserAsync(Ct);
        var (statuses, slugs) = await CreateConcurrentlyAsync(owner, "Fırtına", 8);
        Assert.All(statuses, status => Assert.True(status is 201 or 409, $"status {status}"));
        Assert.Contains(201, statuses);
        Assert.Equal(statuses.Count(s => s == 201), slugs.Count);
        Assert.Equal(slugs.Count, slugs.Distinct(StringComparer.Ordinal).Count());
    }

    private async Task<(int?[] Statuses, List<string> Slugs)> CreateConcurrentlyAsync(Guid owner, string name, int count)
    {
        var animals = new List<Guid>();
        await using (var seed = database.CreateContext())
        {
            for (var i = 0; i < count; i++)
            {
                var animal = new Animal { CreatedBy = owner, Name = name, Location = new GeoPoint(29, 41) };
                seed.Animals.Add(animal);
                animals.Add(animal.Id);
            }
            await seed.SaveChangesAsync(Ct);
        }

        using var start = new Barrier(count);
        var statuses = await Task.WhenAll(animals.Select(id => Task.Run(async () =>
        {
            await using var db = database.CreateContext();
            start.SignalAndWait(Ct);
            var result = await AdoptionEndpoints.Create(id, new("Sıcak bir yuva arıyor", "Takip", "Kadıköy"), Http(owner), db, Ct);
            return Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode;
        }, Ct)));
        await using var check = database.CreateContext();
        var slugs = await check.AdoptionPosts.Where(p => animals.Contains(p.AnimalId)).Select(p => p.Slug).ToListAsync(Ct);
        return (statuses, slugs);
    }

    [Fact]
    public async Task ALostRaceOnTheSlugIndexIsRetriedWithTheNextSuffix()
    {
        await using var db = database.CreateContext();
        var winner = new CarePlace { Name = "Yarış Kliniği", District = "Kadıköy", Address = "Sokak", Location = new GeoPoint(29, 41) };
        db.CarePlaces.Add(winner);
        await db.SaveChangesAsync(Ct);
        Assert.Equal("yaris-klinigi-kadikoy", winner.Slug);

        // The loser had picked the same slug before the winner's row was visible.
        await using var loserDb = database.CreateContext();
        var loser = new CarePlace { Name = "Yarış Kliniği", District = "Kadıköy", Address = "Sokak", Location = new GeoPoint(29, 41), Slug = winner.Slug };
        loserDb.CarePlaces.Add(loser);
        await loserDb.SaveChangesWithSlugRetryAsync(Ct);
        Assert.Equal("yaris-klinigi-kadikoy-2", loser.Slug);
    }

    [Fact]
    public async Task PersistentSlugConflictsEndInAProblemResponseNotAServerError()
    {
        var owner = await database.CreateUserAsync(Ct);
        Guid animalId;
        await using (var seed = database.CreateContext())
        {
            var animal = new Animal { CreatedBy = owner, Name = "Şanssız", Location = new GeoPoint(29, 41) };
            seed.Animals.Add(animal);
            await seed.SaveChangesAsync(Ct);
            animalId = animal.Id;
        }

        var conflicts = new AlwaysSlugConflict();
        await using var db = new PatikaDbContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql(database.ConnectionString, postgres => postgres.UseNetTopologySuite())
            .AddInterceptors(conflicts).Options);
        var result = await AdoptionEndpoints.Create(animalId, new("Sıcak bir yuva arıyor", "Takip", "Kadıköy"), Http(owner), db, Ct);

        Assert.Equal(409, Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode);
        Assert.Equal(PublicSlugSaving.MaxAttempts, conflicts.Attempts);
    }

    private sealed class AlwaysSlugConflict : SaveChangesInterceptor
    {
        public int Attempts { get; private set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Attempts++;
            throw new DbUpdateException("duplicate", new PostgresException("duplicate key value violates unique constraint",
                "ERROR", "ERROR", PostgresErrorCodes.UniqueViolation, constraintName: "IX_adoption_posts_slug"));
        }
    }

    private static DefaultHttpContext Http(Guid userId) => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(PatikaClaims.Subject, userId.ToString()),
            new Claim(PatikaClaims.Role, "User")], "Test"))
    };
}
