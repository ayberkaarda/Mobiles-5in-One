using System.Net;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Media;
using Patika.Contracts.Subscriptions;
using Patika.Domain.Entities;
using Patika.Infrastructure.Billing;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.Api.Tests.Subscriptions;

public sealed class VerificationTests(PostgisFixture fixture) : IClassFixture<PostgisFixture>
{
    private static readonly IDataProtectionProvider Protection = new EphemeralDataProtectionProvider();
    private static readonly BillingOptions AllowTest = new() { AllowTestPurchases = true };
    private static readonly BillingAccountIds Accounts = new(new byte[32]);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static PlaySubscription Purchase(Guid? account, string state = "SUBSCRIPTION_STATE_ACTIVE", int days = 30,
        string product = BillingTokens.Product, string? linked = null, bool test = true) => new(
        [new(product, DateTimeOffset.UtcNow.AddDays(days), new(true), new("aylik"))],
        state, "ACKNOWLEDGEMENT_STATE_PENDING", linked, test ? System.Text.Json.JsonSerializer.SerializeToElement(new { }) : null,
        account is { } id ? new ExternalAccountIdentifiers(Accounts.For(id)) : null);

    private static SubscriptionService Service(PatikaDbContext db, IPlayDeveloperApi play, BillingOptions? options = null) =>
        new(db, play, Protection, TimeProvider.System, options ?? AllowTest);

    private static Task<EntitlementResponse> Verify(SubscriptionService service, Guid userId, string token) =>
        service.VerifyAsync(userId, Accounts.For(userId), new(BillingTokens.Product, "aylik", token), Ct);

    private static async Task<User> UserAsync(PatikaDbContext db, string name = "Destekçi")
    {
        var user = new User { DisplayName = name };
        db.Users.Add(user);
        await db.SaveChangesAsync(Ct);
        return user;
    }

    [Fact]
    public async Task VerifyAcknowledgesIsIdempotentAndRaisesQuotaEntitlement()
    {
        await using var db = fixture.CreateContext();
        var user = await UserAsync(db);
        var fake = new FakePlayDeveloperApi(db, Protection);
        var service = Service(db, fake);
        var quota = new EfSupporterEntitlement(db, AllowTest);
        Assert.False(await quota.IsSupporterAsync(user.Id, DateTimeOffset.UtcNow, Ct));
        Assert.Equal(30, new Patika.Infrastructure.Media.MediaSettings().DailyQuota);
        var token = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, token, Purchase(user.Id), Ct);
        Assert.True((await Verify(service, user.Id, token)).Supporter);
        Assert.True((await Verify(service, user.Id, token)).Supporter);
        Assert.True(await quota.IsSupporterAsync(user.Id, DateTimeOffset.UtcNow, Ct));
        Assert.Equal(100, new Patika.Infrastructure.Media.MediaSettings().SupporterDailyQuota);
        var row = await db.Subscriptions.SingleAsync(x => x.UserId == user.Id, Ct);
        Assert.True(row.Acknowledged);
        Assert.Equal(BillingEnvironment.Test, row.Environment);
        Assert.DoesNotContain(token, row.ProtectedPurchaseToken);
        Assert.Equal("ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED", (await fake.GetSubscriptionV2(BillingTokens.Package, token, Ct)).AcknowledgementState);
        // The grant names the person whose verification caused it.
        var grant = await db.AuditLogs.SingleAsync(x => x.TargetId == row.Id && x.Action == "subscription.granted", Ct);
        Assert.Equal(user.Id, grant.ActorId);
    }

    [Theory]
    [InlineData("SUBSCRIPTION_STATE_EXPIRED", -1, BillingTokens.Product, BillingTokens.Package, "invalid_purchase")]
    [InlineData("SUBSCRIPTION_STATE_ACTIVE", -1, BillingTokens.Product, BillingTokens.Package, "invalid_purchase")]
    [InlineData("SUBSCRIPTION_STATE_ACTIVE", 30, "other", BillingTokens.Package, "invalid_purchase")]
    [InlineData("SUBSCRIPTION_STATE_ACTIVE", 30, BillingTokens.Product, "other.package", "purchase_not_found")]
    public async Task RejectsInvalidStorePurchase(string state, int days, string product, string package, string code)
    {
        await using var db = fixture.CreateContext();
        var user = await UserAsync(db);
        var fake = new FakePlayDeveloperApi(db, Protection); var token = Guid.NewGuid().ToString();
        await fake.SeedAsync(package, token, Purchase(user.Id, state, days, product), Ct);
        var error = await Assert.ThrowsAsync<PurchaseRejectedException>(() => Verify(Service(db, fake), user.Id, token));
        Assert.Equal(code, error.Code);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Gone)]
    public async Task GoogleNotFoundIsPurchaseNotFoundInsteadOfAServerError(HttpStatusCode status)
    {
        await using var db = fixture.CreateContext();
        var user = await UserAsync(db);
        var play = new ThrowingPlay(new HttpRequestException("gone", null, status));
        var error = await Assert.ThrowsAsync<PurchaseRejectedException>(() => Verify(Service(db, play), user.Id, Guid.NewGuid().ToString()));
        Assert.Equal("purchase_not_found", error.Code);
    }

    [Fact]
    public async Task ForeignTokenCannotBeClaimedAndLinkedTokenIsSuperseded()
    {
        await using var db = fixture.CreateContext();
        var owner = await UserAsync(db, "Sahip");
        var stranger = await UserAsync(db, "Yabancı");
        var fake = new FakePlayDeveloperApi(db, Protection); var service = Service(db, fake);
        var old = Guid.NewGuid().ToString(); var next = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, old, Purchase(owner.Id), Ct);
        await Verify(service, owner.Id, old);
        var error = await Assert.ThrowsAsync<PurchaseRejectedException>(() => Verify(service, stranger.Id, old));
        Assert.Equal("purchase_owned_elsewhere", error.Code);
        // Even a successor bought under the stranger's account id cannot take over the owner's predecessor.
        await fake.SeedAsync(BillingTokens.Package, next, Purchase(stranger.Id, linked: old), Ct);
        var foreign = await Assert.ThrowsAsync<PurchaseRejectedException>(() => Verify(service, stranger.Id, next));
        Assert.Equal("purchase_owned_elsewhere", foreign.Code);
        await fake.SeedAsync(BillingTokens.Package, next, Purchase(owner.Id, linked: old), Ct);
        await Verify(service, owner.Id, next);
        Assert.Equal(SubscriptionStatus.Revoked, (await db.Subscriptions.SingleAsync(x => x.PurchaseTokenHash == BillingTokens.Hash(old), Ct)).Status);
        Assert.Equal(2, await db.Subscriptions.CountAsync(x => x.UserId == owner.Id, Ct));
        Assert.Equal(2, await db.AuditLogs.CountAsync(x => x.ActorId == stranger.Id && x.Action == "subscription.claim_rejected", Ct));
    }

    [Fact]
    public async Task ChainThroughAnUnregisteredPredecessorCannotCrossAccounts()
    {
        await using var db = fixture.CreateContext();
        var a = await UserAsync(db, "A");
        var b = await UserAsync(db, "B");
        var fake = new FakePlayDeveloperApi(db, Protection);
        string t0 = Guid.NewGuid().ToString(), t1 = Guid.NewGuid().ToString(), t2 = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, t0, Purchase(a.Id), Ct);
        await Verify(Service(db, fake), a.Id, t0);
        // T1 replaces T0 but is never presented here; T2 replaces T1. All three were bought for A.
        await fake.SeedAsync(BillingTokens.Package, t1, Purchase(a.Id, linked: t0), Ct);
        await fake.SeedAsync(BillingTokens.Package, t2, Purchase(a.Id, linked: t1), Ct);

        // B alone: neither T2 nor its predecessor T1 has a row, yet the purchase is A's.
        var alone = await Assert.ThrowsAsync<PurchaseRejectedException>(() => Verify(Service(db, fake), b.Id, t2));
        Assert.Equal("purchase_owned_elsewhere", alone.Code);
        Assert.False(await db.Subscriptions.AnyAsync(x => x.PurchaseTokenHash == BillingTokens.Hash(t2), Ct));

        // B and A race for T2 on separate connections: only A can bind it.
        await using var dbA = fixture.CreateContext();
        await using var dbB = fixture.CreateContext();
        var claimA = Verify(Service(dbA, new FakePlayDeveloperApi(dbA, Protection)), a.Id, t2);
        var claimB = Verify(Service(dbB, new FakePlayDeveloperApi(dbB, Protection)), b.Id, t2);
        Assert.True((await claimA).Supporter);
        var rejected = await Assert.ThrowsAsync<PurchaseRejectedException>(() => claimB);
        Assert.Equal("purchase_owned_elsewhere", rejected.Code);
        Assert.False((await Service(db, fake).EntitlementAsync(b.Id, Ct)).Supporter);
        Assert.Equal(a.Id, (await db.Subscriptions.AsNoTracking().SingleAsync(x => x.PurchaseTokenHash == BillingTokens.Hash(t2), Ct)).UserId);
        Assert.True(await db.AuditLogs.AnyAsync(x => x.ActorId == b.Id && x.Action == "subscription.claim_rejected", Ct));
    }

    [Fact]
    public async Task PurchaseWithoutTheCallersAccountIdIsRejected()
    {
        await using var db = fixture.CreateContext();
        var user = await UserAsync(db);
        var fake = new FakePlayDeveloperApi(db, Protection);
        var token = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, token, Purchase(account: null), Ct);
        var error = await Assert.ThrowsAsync<PurchaseRejectedException>(() => Verify(Service(db, fake), user.Id, token));
        Assert.Equal("purchase_owned_elsewhere", error.Code);
        Assert.False(await db.Subscriptions.AnyAsync(x => x.PurchaseTokenHash == BillingTokens.Hash(token), Ct));
    }

    [Fact]
    public async Task PurgedOwnersTokenIsRefusedAndAudited()
    {
        await using var db = fixture.CreateContext();
        var owner = await UserAsync(db, "Silinen");
        var fake = new FakePlayDeveloperApi(db, Protection);
        var token = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, token, Purchase(owner.Id), Ct);
        await Verify(Service(db, fake), owner.Id, token);
        await db.Subscriptions.Where(x => x.UserId == owner.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.UserId, (Guid?)null), Ct);
        var returning = await UserAsync(db, "Yeni hesap");
        var error = await Assert.ThrowsAsync<PurchaseRejectedException>(() => Verify(Service(db, fake), returning.Id, token));
        Assert.Equal("purchase_owned_elsewhere", error.Code);
        Assert.True(await db.AuditLogs.AnyAsync(x => x.ActorId == returning.Id && x.Action == "subscription.claim_rejected", Ct));
    }

    [Fact]
    public async Task TestPurchasesGrantNothingWhenThePolicyIsOff()
    {
        await using var db = fixture.CreateContext();
        var user = await UserAsync(db);
        var fake = new FakePlayDeveloperApi(db, Protection);
        var off = new BillingOptions { AllowTestPurchases = false };
        var token = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, token, Purchase(user.Id), Ct);
        var error = await Assert.ThrowsAsync<PurchaseRejectedException>(() => Verify(Service(db, fake, off), user.Id, token));
        Assert.Equal("test_purchase_not_allowed", error.Code);

        // A row recorded while test purchases were allowed stops counting once they are not.
        await Verify(Service(db, fake), user.Id, token);
        Assert.True((await Service(db, fake).EntitlementAsync(user.Id, Ct)).Supporter);
        Assert.False((await Service(db, fake, off).EntitlementAsync(user.Id, Ct)).Supporter);
        Assert.False(await new EfSupporterEntitlement(db, off).IsSupporterAsync(user.Id, DateTimeOffset.UtcNow, Ct));

        // A paid purchase is unaffected.
        var paid = Guid.NewGuid().ToString();
        await fake.SeedAsync(BillingTokens.Package, paid, Purchase(user.Id, test: false), Ct);
        Assert.True((await Verify(Service(db, fake, off), user.Id, paid)).Supporter);
        Assert.True(await new EfSupporterEntitlement(db, off).IsSupporterAsync(user.Id, DateTimeOffset.UtcNow, Ct));
    }

    [Fact]
    public async Task SlowStoreCallForOneTokenDoesNotBlockAnotherToken()
    {
        await using var setup = fixture.CreateContext();
        var a = await UserAsync(setup, "Yavaş");
        var b = await UserAsync(setup, "Hızlı");
        var seed = new FakePlayDeveloperApi(setup, Protection);
        string slowToken = Guid.NewGuid().ToString(), fastToken = Guid.NewGuid().ToString();
        await seed.SeedAsync(BillingTokens.Package, slowToken, Purchase(a.Id), Ct);
        await seed.SeedAsync(BillingTokens.Package, fastToken, Purchase(b.Id), Ct);

        await using var slowDb = fixture.CreateContext();
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var slow = new SlowAcknowledge(new FakePlayDeveloperApi(slowDb, Protection), slowToken, release.Task);
        // The acknowledgement runs under the token lock, so A holds its lock while Play hangs.
        var slowClaim = Verify(Service(slowDb, slow), a.Id, slowToken);
        await slow.Entered.WaitAsync(TimeSpan.FromSeconds(30), Ct);

        await using var fastDb = fixture.CreateContext();
        var fastClaim = Verify(Service(fastDb, new FakePlayDeveloperApi(fastDb, Protection)), b.Id, fastToken);
        bool fastFinishedFirst;
        try
        {
            var finished = await Task.WhenAny(fastClaim, Task.Delay(TimeSpan.FromSeconds(15), Ct));
            fastFinishedFirst = ReferenceEquals(finished, fastClaim) && !slowClaim.IsCompleted;
        }
        finally
        {
            // Released either way, and both claims finish before their contexts are disposed.
            release.TrySetResult();
        }
        Assert.True((await slowClaim).Supporter);
        Assert.True((await fastClaim).Supporter);
        Assert.True(fastFinishedFirst, "Verifying token B waited for the store call on token A.");
    }

    private sealed class ThrowingPlay(Exception error) : IPlayDeveloperApi
    {
        public Task<PlaySubscription> GetSubscriptionV2(string packageName, string purchaseToken, CancellationToken ct = default) => throw error;
        public Task Acknowledge(string packageName, string productId, string purchaseToken, CancellationToken ct = default) => throw error;
    }

    private sealed class SlowAcknowledge(IPlayDeveloperApi inner, string token, Task release) : IPlayDeveloperApi
    {
        private readonly TaskCompletionSource entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task Entered => entered.Task;
        public Task<PlaySubscription> GetSubscriptionV2(string packageName, string purchaseToken, CancellationToken ct = default) =>
            inner.GetSubscriptionV2(packageName, purchaseToken, ct);
        public async Task Acknowledge(string packageName, string productId, string purchaseToken, CancellationToken ct = default)
        {
            if (purchaseToken == token)
            {
                entered.TrySetResult();
                await release.WaitAsync(ct);
            }
            await inner.Acknowledge(packageName, productId, purchaseToken, ct);
        }
    }
}
