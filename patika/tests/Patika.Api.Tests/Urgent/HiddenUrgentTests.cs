using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Urgent;
using Patika.Domain;
using Patika.Domain.Entities;
using Xunit;

namespace Patika.Api.Tests.Urgent;

public sealed class HiddenUrgentTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    [Fact]
    public async Task HiddenPostsAreExcludedFromDetailNearAndEntityQueries()
    {
        var ct = TestContext.Current.CancellationToken;
        var userId = await database.CreateUserAsync(ct);
        await using var db = database.CreateContext();
        var hidden = new UrgentPost { CreatedBy = userId, Description = "Hidden", PhotoKey = "urgent/test", Location = new GeoPoint(29, 41), HiddenAt = DateTimeOffset.UtcNow, HiddenReason = "Review", State = UrgentPostState.Open };
        var visible = new UrgentPost { CreatedBy = userId, Description = "Visible", PhotoKey = "urgent/test", Location = new GeoPoint(29, 41), State = UrgentPostState.Open };
        db.UrgentPosts.AddRange(hidden, visible);
        await db.SaveChangesAsync(ct);
        var store = new EfUrgentStore(db);
        Assert.Null(await store.FindAsync(hidden.Id, ct));
        Assert.NotNull(await store.FindAsync(visible.Id, ct));
        var nearby = await store.NearAsync(new GeoPoint(29, 41), 2000, 100, ct);
        Assert.DoesNotContain(nearby, p => p.Id == hidden.Id);
        Assert.Contains(nearby, p => p.Id == visible.Id);
        Assert.False(await db.UrgentPosts.AnyAsync(p => p.Id == hidden.Id, ct));
        Assert.True(await db.UrgentPosts.IgnoreQueryFilters().AnyAsync(p => p.Id == hidden.Id, ct));
    }
}
