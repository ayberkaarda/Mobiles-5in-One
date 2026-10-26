using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Media;
using Patika.Contracts.Subscriptions;
using Patika.Domain.Entities;
using Patika.Infrastructure.Billing;
using Xunit;

namespace Patika.Api.Tests.Subscriptions;

public sealed class VerificationTests(PostgisFixture fixture) : IClassFixture<PostgisFixture>
{
    private static readonly IDataProtectionProvider Protection = new EphemeralDataProtectionProvider();
    private static PlaySubscription Purchase(string state = "SUBSCRIPTION_STATE_ACTIVE", int days = 30,
        string product = BillingTokens.Product, string? linked = null) => new(
        [new(product, DateTimeOffset.UtcNow.AddDays(days), new(true), new("aylik"))],
        state, "ACKNOWLEDGEMENT_STATE_PENDING", linked, System.Text.Json.JsonSerializer.SerializeToElement(new { }));

    [Fact]
    public async Task VerifyAcknowledgesIsIdempotentAndRaisesQuotaEntitlement()
    {
        await using var db = fixture.CreateContext();
        var user = new User { DisplayName = "Destekçi" }; db.Users.Add(user); await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        var fake = new FakePlayDeveloperApi(db, Protection);
        var service = new SubscriptionService(db, fake, Protection, TimeProvider.System);
        var quota = new EfSupporterEntitlement(db);
        Assert.False(await quota.IsSupporterAsync(user.Id, DateTimeOffset.UtcNow, TestContext.Current.CancellationToken));
        Assert.Equal(30, new Patika.Infrastructure.Media.MediaSettings().DailyQuota);
        var token = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, token, Purchase(), TestContext.Current.CancellationToken);
        var request = new VerifySubscriptionRequest(BillingTokens.Product, "aylik", token);
        Assert.True((await service.VerifyAsync(user.Id, request, TestContext.Current.CancellationToken)).Supporter);
        Assert.True((await service.VerifyAsync(user.Id, request, TestContext.Current.CancellationToken)).Supporter);
        Assert.True(await quota.IsSupporterAsync(user.Id, DateTimeOffset.UtcNow, TestContext.Current.CancellationToken));
        Assert.Equal(100, new Patika.Infrastructure.Media.MediaSettings().SupporterDailyQuota);
        var row = await db.Subscriptions.SingleAsync(x => x.UserId == user.Id, TestContext.Current.CancellationToken);
        Assert.True(row.Acknowledged);
        Assert.Equal(BillingEnvironment.Test, row.Environment);
        Assert.DoesNotContain(token, row.ProtectedPurchaseToken);
        Assert.Equal("ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED", (await fake.GetSubscriptionV2(BillingTokens.Package, token, TestContext.Current.CancellationToken)).AcknowledgementState);
        Assert.Equal(1, await db.AuditLogs.CountAsync(x => x.TargetId == row.Id && x.Action == "subscription.granted", TestContext.Current.CancellationToken));
    }
    [Theory]
    [InlineData("SUBSCRIPTION_STATE_EXPIRED", -1, BillingTokens.Product, BillingTokens.Package)]
    [InlineData("SUBSCRIPTION_STATE_ACTIVE", -1, BillingTokens.Product, BillingTokens.Package)]
    [InlineData("SUBSCRIPTION_STATE_ACTIVE", 30, "other", BillingTokens.Package)]
    [InlineData("SUBSCRIPTION_STATE_ACTIVE", 30, BillingTokens.Product, "other.package")]
    public async Task RejectsInvalidStorePurchase(string state, int days, string product, string package)
    {
        await using var db = fixture.CreateContext();
        var fake = new FakePlayDeveloperApi(db, Protection); var token = Guid.NewGuid().ToString();
        await fake.SeedAsync(package, token, Purchase(state, days, product), TestContext.Current.CancellationToken);
        var service = new SubscriptionService(db, fake, Protection, TimeProvider.System);
        var error = await Assert.ThrowsAsync<PurchaseRejectedException>(() => service.VerifyAsync(Guid.NewGuid(), new(BillingTokens.Product, "aylik", token), TestContext.Current.CancellationToken));
        Assert.Equal("invalid_purchase", error.Code);
    }
    [Fact]
    public async Task ForeignTokenCannotBeClaimedAndLinkedTokenIsSuperseded()
    {
        await using var db = fixture.CreateContext();
        var owner = new User { DisplayName = "Sahip" }; db.Users.Add(owner); await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        var fake = new FakePlayDeveloperApi(db, Protection); var service = new SubscriptionService(db, fake, Protection, TimeProvider.System);
        var old = Guid.NewGuid().ToString(); var next = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, old, Purchase(), TestContext.Current.CancellationToken);
        await service.VerifyAsync(owner.Id, new(BillingTokens.Product, "aylik", old), TestContext.Current.CancellationToken);
        var error = await Assert.ThrowsAsync<PurchaseRejectedException>(() => service.VerifyAsync(Guid.NewGuid(), new(BillingTokens.Product, "aylik", old), TestContext.Current.CancellationToken));
        Assert.Equal("purchase_owned_elsewhere", error.Code);
        await fake.SeedAsync(BillingTokens.Package, next, Purchase(linked: old), TestContext.Current.CancellationToken);
        var foreign = await Assert.ThrowsAsync<PurchaseRejectedException>(() => service.VerifyAsync(Guid.NewGuid(), new(BillingTokens.Product, "aylik", next), TestContext.Current.CancellationToken));
        Assert.Equal("purchase_owned_elsewhere", foreign.Code);
        await service.VerifyAsync(owner.Id, new(BillingTokens.Product, "aylik", next), TestContext.Current.CancellationToken);
        Assert.Equal(SubscriptionStatus.Revoked, (await db.Subscriptions.SingleAsync(x => x.PurchaseTokenHash == BillingTokens.Hash(old), TestContext.Current.CancellationToken)).Status);
        Assert.Equal(2, await db.Subscriptions.CountAsync(x => x.UserId == owner.Id, TestContext.Current.CancellationToken));
    }
}
