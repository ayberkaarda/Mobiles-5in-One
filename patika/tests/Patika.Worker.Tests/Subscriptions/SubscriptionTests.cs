using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Patika.Domain.Entities;
using Patika.Infrastructure.Billing;
using Patika.Worker.Jobs.Subscriptions;
using Xunit;

namespace Patika.Worker.Tests.Subscriptions;

public sealed class SubscriptionTests(WorkerPostgisFixture fixture) : IClassFixture<WorkerPostgisFixture>
{
    // The service compares this with what Play returns; the key behind it is the API's concern.
    private const string Account = "acct-worker";
    private static readonly BillingOptions Options = new() { AllowTestPurchases = true };

    [Theory]
    [InlineData("CANCELED", SubscriptionStatus.Canceled, true)]
    [InlineData("EXPIRED", SubscriptionStatus.Expired, false)]
    [InlineData("REVOKED", SubscriptionStatus.Revoked, false)]
    [InlineData("ON_HOLD", SubscriptionStatus.OnHold, false)]
    [InlineData("IN_GRACE_PERIOD", SubscriptionStatus.InGracePeriod, true)]
    [InlineData("ACTIVE", SubscriptionStatus.Active, true)]
    public async Task NotificationTypeDoesNotGrantState(string state, SubscriptionStatus expected, bool supporter)
    {
        await using var db = fixture.CreateContext();
        var user = new User { DisplayName = "Gönüllü" }; db.Users.Add(user); await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        var protection = new EphemeralDataProtectionProvider(); var fake = new FakePlayDeveloperApi(db, protection);
        var service = new SubscriptionService(db, fake, protection, TimeProvider.System, Options);
        var processor = new SubscriptionProcessor(db, service, TimeProvider.System);
        var token = Guid.NewGuid().ToString();
        var purchase = new PlaySubscription([new(BillingTokens.Product, DateTimeOffset.UtcNow.AddDays(30), new(true), new("aylik"))],
            "SUBSCRIPTION_STATE_ACTIVE", "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED", ExternalAccountIdentifiers: new(Account));
        await fake.SeedAsync(BillingTokens.Package, token, purchase, TestContext.Current.CancellationToken);
        await service.VerifyAsync(user.Id, Account, new(BillingTokens.Product, "aylik", token), TestContext.Current.CancellationToken);
        await fake.SeedAsync(BillingTokens.Package, token, purchase with { SubscriptionState = "SUBSCRIPTION_STATE_" + state }, TestContext.Current.CancellationToken);
        db.PlayNotifications.Add(new PlayNotification
        {
            MessageId = Guid.NewGuid().ToString(),
            Type = "renewed",
            PayloadHash = "unused",
            PurchaseTokenHash = BillingTokens.Hash(token),
            EventAt = DateTimeOffset.UtcNow,
            ReceivedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        await processor.ProcessAsync(TestContext.Current.CancellationToken);
        await processor.ProcessAsync(TestContext.Current.CancellationToken);
        Assert.Equal(expected, (await db.Subscriptions.SingleAsync(x => x.UserId == user.Id, TestContext.Current.CancellationToken)).Status);
        Assert.Equal(supporter, (await service.EntitlementAsync(user.Id, TestContext.Current.CancellationToken)).Supporter);
        Assert.Equal(0, await db.PlayNotifications.CountAsync(x => x.PurchaseTokenHash == BillingTokens.Hash(token) && x.ProcessedAt == null, TestContext.Current.CancellationToken));
    }
    [Fact]
    public async Task ReconcileExpiresStaleActivePurchase()
    {
        await using var db = fixture.CreateContext();
        var protection = new EphemeralDataProtectionProvider(); var fake = new FakePlayDeveloperApi(db, protection);
        var token = Guid.NewGuid().ToString();
        var owner = new User { DisplayName = "Eski destekçi" }; db.Users.Add(owner); await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        var row = new Subscription
        {
            UserId = owner.Id,
            PurchaseTokenHash = BillingTokens.Hash(token),
            ProductId = BillingTokens.Product,
            ProtectedPurchaseToken = protection.CreateProtector("Patika.Play.PurchaseToken.v1").Protect(token),
            Status = SubscriptionStatus.Active,
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1),
            LastEventAt = DateTimeOffset.UtcNow.AddDays(-2)
        };
        db.Subscriptions.Add(row); await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        await fake.SeedAsync(BillingTokens.Package, token, new([new(BillingTokens.Product, row.ExpiresAt, new(true), new("aylik"))],
            "SUBSCRIPTION_STATE_ACTIVE", "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"), TestContext.Current.CancellationToken);
        var service = new SubscriptionService(db, fake, protection, TimeProvider.System, Options);
        await new SubscriptionProcessor(db, service, TimeProvider.System).ReconcileAsync(TestContext.Current.CancellationToken);
        Assert.Equal(SubscriptionStatus.Expired, (await db.Subscriptions.AsNoTracking().SingleAsync(x => x.Id == row.Id, TestContext.Current.CancellationToken)).Status);
        Assert.True(await db.AuditLogs.AnyAsync(x => x.TargetId == row.Id && x.Action == "subscription.revoked", TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("3")]  // SUBSCRIPTION_CANCELED
    [InlineData("12")] // SUBSCRIPTION_REVOKED
    [InlineData("13")] // SUBSCRIPTION_EXPIRED
    public async Task RevokingNotificationTypeCannotOverrideActiveStoreState(string type)
    {
        await using var db = fixture.CreateContext();
        var (service, fake, user, token) = await VerifiedAsync(db);
        var processor = new SubscriptionProcessor(db, service, TimeProvider.System);
        db.PlayNotifications.Add(Notification(token, type));
        await db.SaveChangesAsync(Ct);
        await processor.ProcessAsync(Ct);
        var row = await db.Subscriptions.AsNoTracking().SingleAsync(x => x.UserId == user.Id, Ct);
        Assert.Equal(SubscriptionStatus.Active, row.Status);
        Assert.True((await service.EntitlementAsync(user.Id, Ct)).Supporter);
        Assert.Equal("SUBSCRIPTION_STATE_ACTIVE", (await fake.GetSubscriptionV2(BillingTokens.Package, token, Ct)).SubscriptionState);
    }

    [Fact]
    public async Task FailingNotificationDoesNotBlockLaterOnesAndIsSetAsideAfterTheLimit()
    {
        await using var db = fixture.CreateContext();
        var (service, fake, _, broken) = await VerifiedAsync(db);
        // The store no longer knows the unexpired purchase: refresh throws on every attempt.
        await db.Set<FakePlayPurchase>().Where(x => x.TokenHash == BillingTokens.Hash(broken)).ExecuteDeleteAsync(Ct);
        var other = new User { DisplayName = "Komşu" }; db.Users.Add(other); await db.SaveChangesAsync(Ct);
        var token = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, token, Active(), Ct);
        await service.VerifyAsync(other.Id, Account, new(BillingTokens.Product, "aylik", token), Ct);
        await fake.SeedAsync(BillingTokens.Package, token, Active() with { SubscriptionState = "SUBSCRIPTION_STATE_ON_HOLD" }, Ct);
        var failing = Notification(broken, "2");
        failing.ReceivedAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        db.PlayNotifications.AddRange(failing, Notification(token, "5"));
        await db.SaveChangesAsync(Ct);
        var processor = new SubscriptionProcessor(db, service, TimeProvider.System);
        await processor.ProcessAsync(Ct);
        Assert.Equal(SubscriptionStatus.OnHold, (await db.Subscriptions.AsNoTracking().SingleAsync(x => x.UserId == other.Id, Ct)).Status);
        var stuck = await db.PlayNotifications.AsNoTracking().SingleAsync(x => x.Id == failing.Id, Ct);
        Assert.Equal(1, stuck.Attempts);
        Assert.Null(stuck.ProcessedAt);
        for (var i = 1; i < SubscriptionProcessor.MaxAttempts; i++) await processor.ProcessAsync(Ct);
        stuck = await db.PlayNotifications.AsNoTracking().SingleAsync(x => x.Id == failing.Id, Ct);
        Assert.Equal(SubscriptionProcessor.MaxAttempts, stuck.Attempts);
        Assert.NotNull(stuck.ProcessedAt);
    }

    [Fact]
    public async Task ReconcileSkipsPurgedRowsAndContinuesPastFailures()
    {
        await using var db = fixture.CreateContext();
        var (service, fake, user, token) = await VerifiedAsync(db);
        var purged = new Subscription
        {
            PurchaseTokenHash = BillingTokens.Hash(Guid.NewGuid().ToString()),
            ProductId = BillingTokens.Product,
            Status = SubscriptionStatus.Active,
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1),
        };
        db.Subscriptions.Add(purged); await db.SaveChangesAsync(Ct);
        await fake.SeedAsync(BillingTokens.Package, token, Active() with { SubscriptionState = "SUBSCRIPTION_STATE_CANCELED" }, Ct);
        await new SubscriptionProcessor(db, service, TimeProvider.System).ReconcileAsync(Ct);
        Assert.Equal(SubscriptionStatus.Active, (await db.Subscriptions.AsNoTracking().SingleAsync(x => x.Id == purged.Id, Ct)).Status);
        Assert.Equal(SubscriptionStatus.Canceled, (await db.Subscriptions.AsNoTracking().SingleAsync(x => x.UserId == user.Id, Ct)).Status);
    }

    [Fact]
    public async Task BasePlanChangeUnderTheSameTokenFollowsPlayWhenThePlanIsKnown()
    {
        await using var db = fixture.CreateContext();
        var (service, fake, user, token) = await VerifiedAsync(db);
        var processor = new SubscriptionProcessor(db, service, TimeProvider.System);
        var yearly = Active() with { LineItems = [new(BillingTokens.Product, DateTimeOffset.UtcNow.AddDays(365), new(true), new("yillik"))] };
        await fake.SeedAsync(BillingTokens.Package, token, yearly, Ct);
        db.PlayNotifications.Add(Notification(token, "7"));
        await db.SaveChangesAsync(Ct);
        await processor.ProcessAsync(Ct);
        var row = await db.Subscriptions.AsNoTracking().SingleAsync(x => x.UserId == user.Id, Ct);
        Assert.Equal("yillik", row.BasePlanId);
        Assert.True(row.ExpiresAt > DateTimeOffset.UtcNow.AddDays(300));
        Assert.True((await service.EntitlementAsync(user.Id, Ct)).Supporter);

        // A plan this app does not sell is not adopted; the row is left as it was.
        await fake.SeedAsync(BillingTokens.Package, token, yearly with { LineItems = [new(BillingTokens.Product, DateTimeOffset.UtcNow.AddDays(30), new(true), new("haftalik"))] }, Ct);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.RefreshAsync(BillingTokens.Hash(token), DateTimeOffset.UtcNow, Ct));
        Assert.Equal("yillik", (await db.Subscriptions.AsNoTracking().SingleAsync(x => x.UserId == user.Id, Ct)).BasePlanId);
    }

    [Fact]
    public async Task VoidedSubscriptionIsRefreshedAndRevokesWithoutAnActor()
    {
        await using var db = fixture.CreateContext();
        var (service, fake, user, token) = await VerifiedAsync(db);
        await fake.SeedAsync(BillingTokens.Package, token, Active() with { SubscriptionState = "SUBSCRIPTION_STATE_REVOKED" }, Ct);
        db.PlayNotifications.Add(Notification(token, "voided"));
        await db.SaveChangesAsync(Ct);
        await new SubscriptionProcessor(db, service, TimeProvider.System).ProcessAsync(Ct);
        var row = await db.Subscriptions.AsNoTracking().SingleAsync(x => x.UserId == user.Id, Ct);
        Assert.Equal(SubscriptionStatus.Revoked, row.Status);
        Assert.False((await service.EntitlementAsync(user.Id, Ct)).Supporter);
        var revoke = await db.AuditLogs.SingleAsync(x => x.TargetId == row.Id && x.Action == "subscription.revoked", Ct);
        Assert.Null(revoke.ActorId);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static PlaySubscription Active() => new([new(BillingTokens.Product, DateTimeOffset.UtcNow.AddDays(30), new(true), new("aylik"))],
        "SUBSCRIPTION_STATE_ACTIVE", "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED", ExternalAccountIdentifiers: new(Account));

    private static PlayNotification Notification(string token, string type) => new()
    {
        MessageId = Guid.NewGuid().ToString(),
        Type = type,
        PayloadHash = "unused",
        PurchaseTokenHash = BillingTokens.Hash(token),
        EventAt = DateTimeOffset.UtcNow,
        ReceivedAt = DateTimeOffset.UtcNow,
    };

    private static async Task<(SubscriptionService Service, FakePlayDeveloperApi Fake, User User, string Token)> VerifiedAsync(
        Patika.Infrastructure.Persistence.PatikaDbContext db)
    {
        var user = new User { DisplayName = "Destekçi" }; db.Users.Add(user); await db.SaveChangesAsync(Ct);
        var protection = new EphemeralDataProtectionProvider(); var fake = new FakePlayDeveloperApi(db, protection);
        var service = new SubscriptionService(db, fake, protection, TimeProvider.System, Options);
        var token = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, token, Active(), Ct);
        await service.VerifyAsync(user.Id, Account, new(BillingTokens.Product, "aylik", token), Ct);
        return (service, fake, user, token);
    }
}
