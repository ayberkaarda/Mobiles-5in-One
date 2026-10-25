using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Patika.Api.Features.Adoptions;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Adoptions;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.SecurityTests.Adoptions;

public sealed class AdoptionPersistenceTests
{
    public static bool HasDatabase => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PATIKA_TEST_DB"));

    [Fact(SkipUnless = nameof(HasDatabase), Skip = "PATIKA_TEST_DB must identify a migrated test database.")]
    public async Task StoredPostsEnforceOwnershipAndReturnJsonText()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var db = Database();
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var owner = new User { DisplayName = "Sahip" };
        var other = new User { DisplayName = "Ziyaretçi" };
        db.Users.AddRange(owner, other);
        await db.SaveChangesAsync(ct);
        var animal = new Animal { CreatedBy = owner.Id, Location = new GeoPoint(29, 41) };
        db.Animals.Add(animal);
        await db.SaveChangesAsync(ct);
        const string text = "<script>alert(1)</script>";
        var created = await AdoptionEndpoints.Create(animal.Id, new(text + "\u0000", "Güvenli yuva", "Kadıköy"), Context(owner.Id), db, ct);
        Assert.Equal(201, Assert.IsAssignableFrom<IStatusCodeHttpResult>(created).StatusCode);
        var post = await db.AdoptionPosts.SingleAsync(p => p.AnimalId == animal.Id, ct);
        var request = new AdoptionRequest { PostId = post.Id, RequesterId = owner.Id, Message = "Mesaj" };
        db.AdoptionRequests.Add(request);
        await db.SaveChangesAsync(ct);
        Assert.IsType<Microsoft.AspNetCore.Http.HttpResults.ForbidHttpResult>(await AdoptionEndpoints.Update(post.Id, new(null, null, null, "Closed"), Context(other.Id), db, ct));
        Assert.IsType<Microsoft.AspNetCore.Http.HttpResults.ForbidHttpResult>(await AdoptionEndpoints.Requests(post.Id, Context(other.Id), db, ct: ct));
        Assert.IsType<Microsoft.AspNetCore.Http.HttpResults.ForbidHttpResult>(await AdoptionEndpoints.GetRequest(post.Id, request.Id, Context(other.Id), db, ct));
        Assert.IsType<Microsoft.AspNetCore.Http.HttpResults.ForbidHttpResult>(await AdoptionEndpoints.Reply(post.Id, request.Id, new("Yanıt"), Context(other.Id), db, ct));
        Assert.Equal(404, Assert.IsAssignableFrom<IStatusCodeHttpResult>(await AdoptionEndpoints.Get(post.Id, Context(other.Id), db, ct)).StatusCode);
        post.State = AdoptionPostState.Published;
        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
        var response = await AdoptionEndpoints.Get(post.Id, Context(other.Id), db, ct);
        using var services = new ServiceCollection().AddLogging().BuildServiceProvider();
        var http = Context(other.Id);
        http.RequestServices = services;
        http.Response.Body = new MemoryStream();
        await response.ExecuteAsync(http);
        Assert.StartsWith("application/json", http.Response.ContentType);
        http.Response.Body.Position = 0;
        using var document = await JsonDocument.ParseAsync(http.Response.Body, cancellationToken: ct);
        Assert.Equal(text, document.RootElement.GetProperty("description").GetString());
    }

    [Fact(SkipUnless = nameof(HasDatabase), Skip = "PATIKA_TEST_DB must identify a migrated test database.")]
    public async Task ClosureHandlesExpiryAndAdoptionAndIsRepeatable()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var db = Database();
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var user = new User { DisplayName = "Sahip" };
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        var animal = new Animal { CreatedBy = user.Id, Location = new GeoPoint(29, 41), Status = AnimalStatus.Adopted };
        db.Animals.Add(animal);
        await db.SaveChangesAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var post = new AdoptionPost { AnimalId = animal.Id, CreatedBy = user.Id, Description = "Yuva", Requirements = "Bakım", District = "Kadıköy", State = AdoptionPostState.Published, ClosesAt = now.AddDays(60) };
        var healthy = new Animal { CreatedBy = user.Id, Location = new GeoPoint(29, 41), Status = AnimalStatus.Healthy };
        db.Animals.Add(healthy);
        await db.SaveChangesAsync(ct);
        var expired = new AdoptionPost { AnimalId = healthy.Id, CreatedBy = user.Id, Description = "Yuva", Requirements = "Bakım", District = "Kadıköy", State = AdoptionPostState.Pending, ClosesAt = now };
        db.AdoptionPosts.AddRange(post, expired);
        await db.SaveChangesAsync(ct);
        var request = new AdoptionRequest { PostId = post.Id, RequesterId = user.Id, Message = "Mesaj" };
        db.AdoptionRequests.Add(request);
        await db.SaveChangesAsync(ct);
        var service = new AdoptionClosureService(db);
        await service.CloseAsync(now, ct);
        Assert.Equal(AdoptionPostState.Closed, post.State);
        Assert.Equal(AdoptionPostState.Closed, expired.State);
        Assert.Equal(AdoptionRequestState.Closed, request.State);
        Assert.Equal(0, await service.CloseAsync(now, ct));
    }

    private static PatikaDbContext Database() => new(new DbContextOptionsBuilder<PatikaDbContext>()
        .UseNpgsql(Environment.GetEnvironmentVariable("PATIKA_TEST_DB"), options => options.UseNetTopologySuite()).Options);

    private static DefaultHttpContext Context(Guid userId) => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(PatikaClaims.Subject, userId.ToString()),
            new Claim(PatikaClaims.Role, "User")], "Test"))
    };
}
