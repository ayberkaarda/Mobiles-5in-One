using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Patika.Api.Features.Account;
using Patika.Api.Features.Adoptions;
using Patika.Api.Features.Animals;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Urgent;
using Patika.Contracts.Adoptions;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Patika.Domain;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Api.Tests.Adoptions;

/// <summary>Closing outcomes, slugs, district links and birth year through the real endpoints on PostGIS.</summary>
public sealed class AdoptionOutcomeTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task ManualCloseDefaultsToWithdrawnAndAdoptedRecordsTheDate()
    {
        var owner = await database.CreateUserAsync(Ct);
        var withdrawn = await PublishedPostAsync(owner, "Pamuk");
        var adopted = await PublishedPostAsync(owner, "Duman");

        await using (var db = database.CreateContext())
        {
            // An old client: no reason field at all.
            Assert.IsType<Ok<AdoptionPostResponse>>(await AdoptionEndpoints.Update(withdrawn, new(null, null, null, "Closed"), Context(owner), db, Ct));
            Assert.IsType<Ok<AdoptionPostResponse>>(await AdoptionEndpoints.Update(adopted, new(null, null, null, "Closed", "Adopted"), Context(owner), db, Ct));
        }

        await using var check = database.CreateContext();
        var first = await check.AdoptionPosts.SingleAsync(p => p.Id == withdrawn, Ct);
        Assert.Equal(AdoptionPostState.Closed, first.State);
        Assert.Equal(AdoptionClosedReason.Withdrawn, first.ClosedReason);
        Assert.Null(first.AdoptedAt);
        var second = await check.AdoptionPosts.SingleAsync(p => p.Id == adopted, Ct);
        Assert.Equal(AdoptionClosedReason.Adopted, second.ClosedReason);
        Assert.NotNull(second.AdoptedAt);
    }

    [Fact]
    public async Task CreatedPostsGetAStableSlugAndTheirDistrict()
    {
        var owner = await database.CreateUserAsync(Ct);
        var id = await PublishedPostAsync(owner, "Tarçın");
        await using var db = database.CreateContext();
        var post = await db.AdoptionPosts.SingleAsync(p => p.Id == id, Ct);
        var kadikoy = await db.Districts.SingleAsync(d => d.Slug == "kadikoy", Ct);
        Assert.Equal(kadikoy.Id, post.DistrictId);
        // UUIDv7 ids share their leading hex within hours, so a numeric suffix may follow.
        Assert.StartsWith($"tarcin-kadikoy-{id.ToString("N")[..6]}", post.Slug, StringComparison.Ordinal);
        var slug = post.Slug;

        Assert.IsType<Ok<AdoptionPostResponse>>(await AdoptionEndpoints.Update(id, new("Yeni açıklama", null, "Üsküdar", null), Context(owner), db, Ct));
        db.ChangeTracker.Clear();
        var edited = await db.AdoptionPosts.SingleAsync(p => p.Id == id, Ct);
        Assert.Equal(slug, edited.Slug);
        Assert.Equal((await db.Districts.SingleAsync(d => d.Slug == "uskudar", Ct)).Id, edited.DistrictId);
    }

    [Fact]
    public async Task ExpiryAndAccountDeletionRecordTheirReasons()
    {
        var owner = await database.CreateUserAsync(Ct);
        var expired = await PublishedPostAsync(owner, "Zeytin");
        var leaver = await database.CreateUserAsync(Ct);
        var orphaned = await PublishedPostAsync(leaver, "Fındık");
        var now = DateTimeOffset.UtcNow;
        await using (var db = database.CreateContext())
        {
            await db.AdoptionPosts.Where(p => p.Id == expired)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.ClosesAt, now.AddMinutes(-1)), Ct);
            await new AdoptionClosureService(db).CloseAsync(now, Ct);
            await new EfAccountDeletionStore(db).RequestDeletionAsync(leaver, now, TimeSpan.FromDays(7), Ct);
        }

        await using var check = database.CreateContext();
        var first = await check.AdoptionPosts.SingleAsync(p => p.Id == expired, Ct);
        Assert.Equal(AdoptionClosedReason.Expired, first.ClosedReason);
        Assert.Null(first.AdoptedAt);
        Assert.Equal(AdoptionClosedReason.AccountDeleted, (await check.AdoptionPosts.SingleAsync(p => p.Id == orphaned, Ct)).ClosedReason);
    }

    [Fact]
    public async Task AnimalBirthYearRoundTripsThroughCreateAndUpdate()
    {
        var owner = await database.CreateUserAsync(Ct);
        await using var db = database.CreateContext();
        var created = Assert.IsType<Created<AnimalResponse>>(await AnimalEndpoints.CreateAsync(
            new AnimalRequest(new CoordinateDto(41.0, 29.0), "Cat", "Female", "Healthy", Name: "Minnoş", District: "Beşiktaş", BirthYear: 2021),
            Context(owner), db, Ct));
        Assert.Equal((short)2021, created.Value!.BirthYear);
        Assert.Equal((await db.Districts.SingleAsync(d => d.Slug == "besiktas", Ct)).Id,
            (await db.Animals.SingleAsync(a => a.Id == created.Value.Id, Ct)).DistrictId);

        var services = new ServiceCollection().AddLogging().AddAuthorization()
            .AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>().BuildServiceProvider();
        await using var _ = services;
        var updated = Assert.IsType<Ok<AnimalResponse>>(await AnimalEndpoints.UpdateAsync(created.Value.Id,
            new AnimalUpdateRequest(BirthYear: 2019), Context(owner), db, services.GetRequiredService<IAuthorizationService>(), Ct));
        Assert.Equal((short)2019, updated.Value!.BirthYear);
        var unchanged = Assert.IsType<Ok<AnimalResponse>>(await AnimalEndpoints.UpdateAsync(created.Value.Id,
            new AnimalUpdateRequest(Name: "Minnak"), Context(owner), db, services.GetRequiredService<IAuthorizationService>(), Ct));
        Assert.Equal((short)2019, unchanged.Value!.BirthYear);
    }

    private async Task<Guid> PublishedPostAsync(Guid owner, string name)
    {
        await using var db = database.CreateContext();
        var animal = new Animal { CreatedBy = owner, Name = name, Location = new GeoPoint(29, 41) };
        db.Animals.Add(animal);
        await db.SaveChangesAsync(Ct);
        Assert.Equal(201, Assert.IsAssignableFrom<IStatusCodeHttpResult>(
            await AdoptionEndpoints.Create(animal.Id, new("Sıcak bir yuva arıyor", "Kısırlaştırma takibi", "Kadıköy"), Context(owner), db, Ct)).StatusCode);
        var post = await db.AdoptionPosts.SingleAsync(p => p.AnimalId == animal.Id, Ct);
        post.State = AdoptionPostState.Published;
        await db.SaveChangesAsync(Ct);
        return post.Id;
    }

    private static DefaultHttpContext Context(Guid userId) => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(PatikaClaims.Subject, userId.ToString()),
            new Claim(PatikaClaims.Role, "User")], "Test"))
    };
}
