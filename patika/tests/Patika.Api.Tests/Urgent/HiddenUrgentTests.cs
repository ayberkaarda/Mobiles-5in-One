using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Patika.Api.Features.Urgent;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Community;
using Patika.Contracts.Urgent;
using Patika.Domain;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Api.Tests.Urgent;

public sealed class HiddenUrgentTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task HiddenPostsAreExcludedFromDetailNearAndEntityQueries()
    {
        var userId = await database.CreateUserAsync(Ct);
        await using var db = database.CreateContext();
        var hidden = Post(userId, hidden: true);
        var visible = Post(userId, hidden: false);
        db.UrgentPosts.AddRange(hidden, visible);
        await db.SaveChangesAsync(Ct);
        var store = new EfUrgentStore(db);
        Assert.Null(await store.FindAsync(hidden.Id, Ct));
        Assert.NotNull(await store.FindAsync(visible.Id, Ct));
        var nearby = await store.NearAsync(new GeoPoint(29, 41), 2000, 100, Ct);
        Assert.DoesNotContain(nearby, p => p.Id == hidden.Id);
        Assert.Contains(nearby, p => p.Id == visible.Id);
        Assert.False(await db.UrgentPosts.AnyAsync(p => p.Id == hidden.Id, Ct));
        Assert.True(await db.UrgentPosts.IgnoreQueryFilters().AnyAsync(p => p.Id == hidden.Id, Ct));
    }

    [Fact]
    public async Task OwnerHistoryListsHiddenPostsFlaggedAsHidden()
    {
        var owner = await database.CreateUserAsync(Ct);
        await using var db = database.CreateContext();
        var hidden = Post(owner, hidden: true);
        var visible = Post(owner, hidden: false);
        db.UrgentPosts.AddRange(hidden, visible);
        await db.SaveChangesAsync(Ct);

        var page = Assert.IsType<Ok<PageResponse<UrgentPostResponse>>>(await UrgentEndpoints.MyPostsAsync(Http(owner), db, ct: Ct)).Value!;
        Assert.True(Assert.Single(page.Items, p => p.Id == hidden.Id).Hidden);
        Assert.False(Assert.Single(page.Items, p => p.Id == visible.Id).Hidden);
    }

    [Fact]
    public async Task OwnerAndModeratorCanCloseAHiddenPostWhilePublicReadsStill404()
    {
        var owner = await database.CreateUserAsync(Ct);
        var stranger = await database.CreateUserAsync(Ct);
        var moderator = await database.CreateUserAsync(Ct);
        await using var db = database.CreateContext();
        var first = Post(owner, hidden: true);
        var second = Post(owner, hidden: true);
        db.UrgentPosts.AddRange(first, second);
        await db.SaveChangesAsync(Ct);
        var store = new EfUrgentStore(db);
        await using var services = new ServiceCollection().AddLogging().AddAuthorization()
            .AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>().BuildServiceProvider();
        var authorization = services.GetRequiredService<IAuthorizationService>();
        var close = new UpdateUrgentPostRequest(nameof(UrgentPostState.Closed));

        // A stranger gets the public answer: not found, not forbidden.
        Assert.Equal(404, Status(await UrgentEndpoints.UpdateAsync(Http(stranger), first.Id, close, store, authorization, Ct)));
        Assert.Equal(404, Status(await UrgentEndpoints.GetAsync(first.Id, store, Ct)));

        var closed = Assert.IsType<Ok<UrgentPostResponse>>(await UrgentEndpoints.UpdateAsync(Http(owner), first.Id, close, store, authorization, Ct)).Value!;
        Assert.Equal(nameof(UrgentPostState.Closed), closed.State);
        Assert.True(closed.Hidden);
        Assert.IsType<Ok<UrgentPostResponse>>(await UrgentEndpoints.UpdateAsync(Http(moderator, "Moderator"), second.Id, close, store, authorization, Ct));

        db.ChangeTracker.Clear();
        Assert.Equal(2, await db.UrgentPosts.IgnoreQueryFilters()
            .CountAsync(p => (p.Id == first.Id || p.Id == second.Id) && p.State == UrgentPostState.Closed && p.HiddenAt != null, Ct));
        Assert.Equal(404, Status(await UrgentEndpoints.GetAsync(first.Id, store, Ct)));
    }

    private static UrgentPost Post(Guid owner, bool hidden) => new()
    {
        CreatedBy = owner,
        Description = hidden ? "Gizlenen çağrı" : "Görünen çağrı",
        PhotoKey = "urgent/test",
        Location = new GeoPoint(29, 41),
        State = UrgentPostState.Open,
        HiddenAt = hidden ? DateTimeOffset.UtcNow : null,
        HiddenReason = hidden ? "İnceleme" : null,
    };

    private static int? Status(IResult result) => Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode;

    private static DefaultHttpContext Http(Guid userId, string role = "User") => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(PatikaClaims.Subject, userId.ToString()),
            new Claim(PatikaClaims.Role, role)], "Test"))
    };
}
