using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Adoptions;
using Patika.Api.Features.Animals;
using Patika.Api.Features.Urgent;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Adoptions;
using Patika.Contracts.Community;
using Patika.Contracts.Urgent;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace Patika.SecurityTests;

public sealed class MeReadModelIdorTests
{
    [Theory]
    [InlineData("User")]
    [InlineData("Moderator")]
    [InlineData("Admin")]
    public async Task PersonalListsExcludeOtherAccountsAcrossPages(string role)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var server = new PostgreSqlBuilder("postgis/postgis:17-3.5").Build();
        await server.StartAsync(ct);
        await using var db = new PatikaDbContext(new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql(server.GetConnectionString(), pg => pg.UseNetTopologySuite()).Options);
        await db.Database.EnsureCreatedAsync(ct);
        var caller = new User { DisplayName = "Deniz" };
        var other = new User { DisplayName = "Ekin" };
        var animal = new Animal { CreatedBy = other.Id, Location = new GeoPoint(29, 41) };
        var post = new AdoptionPost { AnimalId = animal.Id, CreatedBy = caller.Id, Description = "Description", Requirements = "Requirements", District = "Kadıköy" };
        var ownAnimals = new List<Guid>();
        var ownRequests = new List<Guid>();
        var ownUrgent = new List<Guid>();
        db.AddRange(caller, other, animal, post);
        foreach (var owner in new[] { caller.Id, other.Id })
        {
            for (var i = 0; i < 2; i++)
            {
                var followed = new Animal { CreatedBy = other.Id, Location = new GeoPoint(29, 41) };
                var requestPost = new AdoptionPost { AnimalId = animal.Id, CreatedBy = other.Id, Description = "Description", Requirements = "Requirements", District = "Kadıköy" };
                var request = new AdoptionRequest { PostId = requestPost.Id, RequesterId = owner, Message = "Private message" };
                var urgent = new UrgentPost { CreatedBy = owner, Location = new GeoPoint(29, 41), Description = "Private description", PhotoKey = "urgent/a.jpg" };
                db.AddRange(followed, new Follow { AnimalId = followed.Id, UserId = owner }, requestPost, request, urgent);
                if (owner == caller.Id)
                {
                    ownAnimals.Add(followed.Id);
                    ownRequests.Add(request.Id);
                    ownUrgent.Add(urgent.Id);
                }
            }
        }
        // Owning a post must not expose its incoming requests on the personal requester list.
        db.Add(new AdoptionRequest { PostId = post.Id, RequesterId = other.Id, Message = "Incoming private message" });
        await db.SaveChangesAsync(ct);
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(PatikaClaims.Subject, caller.Id.ToString()), new Claim(PatikaClaims.Role, role)], "test"))
        };
        var animals = new List<Guid>();
        var requests = new List<Guid>();
        var urgentIds = new List<Guid>();
        for (var page = 1; page <= 3; page++)
        {
            var follows = Value<PageResponse<AnimalResponse>>(await AnimalEndpoints.MyFollowsAsync(new PageQuery(page, 1), http, db, ct));
            var adoption = Value<PageResponse<AdoptionRequestResponse>>(await AdoptionEndpoints.MyRequests(http, db, page, 1, ct));
            var urgent = Value<PageResponse<UrgentPostResponse>>(await UrgentEndpoints.MyPostsAsync(http, db, page, 1, ct));
            Assert.Equal(page == 1, follows.HasMore);
            Assert.Equal(page == 1, adoption.HasMore);
            Assert.Equal(page == 1, urgent.HasMore);
            Assert.All(follows.Items, a => Assert.True(a.IsFollowing));
            animals.AddRange(follows.Items.Select(a => a.Id));
            requests.AddRange(adoption.Items.Select(r => r.Id));
            urgentIds.AddRange(urgent.Items.Select(p => p.Id));
        }
        Assert.Equal(ownAnimals.Order(), animals.Order());
        Assert.Equal(ownRequests.Order(), requests.Order());
        Assert.Equal(ownUrgent.Order(), urgentIds.Order());
    }

    private static T Value<T>(IResult result) => Assert.IsType<T>(Assert.IsAssignableFrom<IValueHttpResult>(result).Value);
}
