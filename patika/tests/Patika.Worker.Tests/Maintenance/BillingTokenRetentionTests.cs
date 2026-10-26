using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Patika.Domain.Entities;
using Patika.Worker.Jobs.Maintenance;
using Xunit;

namespace Patika.Worker.Tests.Maintenance;

public sealed class BillingTokenRetentionTests(WorkerPostgisFixture database) : IClassFixture<WorkerPostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task TokensGoNinetyDaysAfterTheSubscriptionEndsOrTheAccountWasPurged()
    {
        var now = DateTimeOffset.UtcNow;
        Guid owner;
        await using (var seed = database.CreateContext())
        {
            var user = new User { DisplayName = "Destekçi" };
            seed.Users.Add(user);
            await seed.SaveChangesAsync(Ct);
            owner = user.Id;
        }

        var endedLongAgo = Row(owner, expires: now.AddDays(-91));
        var endedRecently = Row(owner, expires: now.AddDays(-89));
        var running = Row(owner, expires: now.AddDays(20));
        var purgedLongAgo = Row(null, expires: now.AddDays(-10));
        var purgedRecently = Row(null, expires: now.AddDays(-10));
        var purgedButRunning = Row(null, expires: now.AddDays(10));
        var oldNotice = Notice(now.AddDays(-91));
        var newNotice = Notice(now.AddDays(-1));
        await using (var seed = database.CreateContext())
        {
            seed.Subscriptions.AddRange(endedLongAgo, endedRecently, running, purgedLongAgo, purgedRecently, purgedButRunning);
            seed.PlayNotifications.AddRange(oldNotice, newNotice);
            await seed.SaveChangesAsync(Ct);
            // The purge is the last write to an unbound row; SaveChanges stamps UpdatedAt, so age it afterwards.
            var purgedAt = now.AddDays(-91);
            await seed.Subscriptions.Where(s => s.Id == purgedLongAgo.Id || s.Id == purgedButRunning.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedAt, purgedAt), Ct);
        }

        await using (var db = database.CreateContext())
        {
            var (subscriptions, notifications) = await new BillingTokenRetention(db, TimeProvider.System,
                NullLogger<BillingTokenRetention>.Instance).PurgeAsync(Ct);
            Assert.True(subscriptions >= 2);
            Assert.True(notifications >= 1);
        }

        await using var check = database.CreateContext();
        var left = await check.Subscriptions.Select(s => s.Id).ToListAsync(Ct);
        Assert.DoesNotContain(endedLongAgo.Id, left);
        Assert.DoesNotContain(purgedLongAgo.Id, left);
        Assert.Contains(endedRecently.Id, left);
        Assert.Contains(running.Id, left);
        Assert.Contains(purgedRecently.Id, left);
        Assert.Contains(purgedButRunning.Id, left);
        Assert.Null((await check.PlayNotifications.SingleAsync(n => n.Id == oldNotice.Id, Ct)).PurchaseTokenHash);
        Assert.NotNull((await check.PlayNotifications.SingleAsync(n => n.Id == newNotice.Id, Ct)).PurchaseTokenHash);
    }

    [Fact]
    public async Task ARemovedTokenLeavesNoCopyInItsSuccessorAndPausedOrOnHoldRowsStay()
    {
        var now = DateTimeOffset.UtcNow;
        Guid owner;
        await using (var seed = database.CreateContext())
        {
            var user = new User { DisplayName = "Destekçi" };
            seed.Users.Add(user);
            await seed.SaveChangesAsync(Ct);
            owner = user.Id;
        }

        // A was upgraded to B; B is still running and names A as its predecessor. C (paused) and D (on hold) are
        // past their expiry by more than 90 days, but Play can still resume them.
        var a = Row(owner, expires: now.AddDays(-120), SubscriptionStatus.Revoked);
        var b = Row(owner, expires: now.AddDays(25));
        b.Status = SubscriptionStatus.Active;
        b.LinkedPurchaseTokenHash = a.PurchaseTokenHash;
        var paused = Row(owner, expires: now.AddDays(-100), SubscriptionStatus.Paused);
        var onHold = Row(owner, expires: now.AddDays(-100), SubscriptionStatus.OnHold);
        var successorOfPaused = Row(owner, expires: now.AddDays(25), SubscriptionStatus.Active);
        successorOfPaused.LinkedPurchaseTokenHash = paused.PurchaseTokenHash;
        await using (var seed = database.CreateContext())
        {
            seed.Subscriptions.AddRange(a, b, paused, onHold, successorOfPaused);
            await seed.SaveChangesAsync(Ct);
        }

        await using (var db = database.CreateContext())
        {
            await new BillingTokenRetention(db, TimeProvider.System, NullLogger<BillingTokenRetention>.Instance).PurgeAsync(Ct);
        }

        await using var check = database.CreateContext();
        var rows = await check.Subscriptions.Where(s => new[] { a.Id, b.Id, paused.Id, onHold.Id, successorOfPaused.Id }.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, Ct);
        Assert.False(rows.ContainsKey(a.Id));
        Assert.Null(rows[b.Id].LinkedPurchaseTokenHash);
        Assert.Equal(SubscriptionStatus.Active, rows[b.Id].Status);
        Assert.True(rows.ContainsKey(paused.Id));
        Assert.True(rows.ContainsKey(onHold.Id));
        Assert.Equal(paused.PurchaseTokenHash, rows[successorOfPaused.Id].LinkedPurchaseTokenHash);
        Assert.False(await check.Subscriptions.AnyAsync(
            s => s.PurchaseTokenHash == a.PurchaseTokenHash || s.LinkedPurchaseTokenHash == a.PurchaseTokenHash, Ct));
    }

    private static Subscription Row(Guid? user, DateTimeOffset expires, SubscriptionStatus status = SubscriptionStatus.Expired) => new()
    {
        UserId = user,
        PurchaseTokenHash = Guid.NewGuid().ToString("N"),
        ProtectedPurchaseToken = user is null ? "" : "protected",
        ProductId = "patika_destekci",
        Status = status,
        ExpiresAt = expires,
    };

    private static PlayNotification Notice(DateTimeOffset received) => new()
    {
        MessageId = Guid.NewGuid().ToString("N"),
        Type = "subscription",
        PayloadHash = Guid.NewGuid().ToString("N"),
        PurchaseTokenHash = Guid.NewGuid().ToString("N"),
        EventAt = received,
        ReceivedAt = received,
        ProcessedAt = received,
    };
}
