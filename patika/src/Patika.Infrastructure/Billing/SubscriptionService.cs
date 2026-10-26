using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Patika.Contracts.Subscriptions;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Infrastructure.Billing;

public sealed class PurchaseRejectedException(string code) : Exception(code)
{
    public string Code => Message;
}

public sealed class SubscriptionService(PatikaDbContext db, IPlayDeveloperApi play, IDataProtectionProvider protection, TimeProvider time)
{
    private readonly IDataProtector protector = protection.CreateProtector("Patika.Play.PurchaseToken.v1");

    public async Task<EntitlementResponse> EntitlementAsync(Guid userId, CancellationToken ct = default)
    {
        var rows = await db.Subscriptions.AsNoTracking().Where(x => x.UserId == userId).ToListAsync(ct);
        var row = rows.OrderByDescending(x => HasEntitlement(x, time.GetUtcNow())).ThenByDescending(x => x.ExpiresAt).FirstOrDefault();
        return new(row is not null && HasEntitlement(row, time.GetUtcNow()), row?.ExpiresAt, row?.Status.ToString());
    }

    public static bool HasEntitlement(Subscription row, DateTimeOffset now) => row.ExpiresAt > now &&
        row.Status is SubscriptionStatus.Active or SubscriptionStatus.InGracePeriod or SubscriptionStatus.Canceled;

    public async Task<EntitlementResponse> VerifyAsync(Guid userId, VerifySubscriptionRequest request, CancellationToken ct = default)
    {
        if (request.ProductId != BillingTokens.Product || request.BasePlanId is not ("aylik" or "yillik") ||
            string.IsNullOrWhiteSpace(request.PurchaseToken) || request.PurchaseToken.Length > 4096)
            throw new PurchaseRejectedException("invalid_purchase");
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(ct);
        var hash = BillingTokens.Hash(request.PurchaseToken);
        var row = await db.Subscriptions.SingleOrDefaultAsync(x => x.PurchaseTokenHash == hash, ct);
        if (row is not null && row.UserId != userId) throw new PurchaseRejectedException("purchase_owned_elsewhere");
        PlaySubscription purchase;
        try { purchase = await play.GetSubscriptionV2(BillingTokens.Package, request.PurchaseToken, ct); }
        catch (KeyNotFoundException) { throw new PurchaseRejectedException("invalid_purchase"); }
        var item = purchase.LineItems.FirstOrDefault(x => x.ProductId == request.ProductId && x.OfferDetails?.BasePlanId == request.BasePlanId);
        if (item is null || item.ExpiryTime <= time.GetUtcNow() || purchase.SubscriptionState is not
            ("SUBSCRIPTION_STATE_ACTIVE" or "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"))
            throw new PurchaseRejectedException("invalid_purchase");
        var linkedHash = purchase.LinkedPurchaseToken is { Length: > 0 } linked ? BillingTokens.Hash(linked) : null;
        var old = linkedHash is null ? null : await db.Subscriptions.SingleOrDefaultAsync(x => x.PurchaseTokenHash == linkedHash, ct);
        if (old is not null && old.UserId != userId) throw new PurchaseRejectedException("purchase_owned_elsewhere");
        if (row?.Status == SubscriptionStatus.Revoked) throw new PurchaseRejectedException("purchase_superseded");
        var user = await db.Users.FromSql($"SELECT * FROM users WHERE id = {userId} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (user is not null) await db.Entry(user).ReloadAsync(ct);
        if (user is null || user.DeactivatedAt is not null || user.SuspendedUntil > time.GetUtcNow())
            throw new PurchaseRejectedException("account_inactive");
        if (purchase.AcknowledgementState != "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        {
            await play.Acknowledge(BillingTokens.Package, request.ProductId, request.PurchaseToken, ct);
            purchase = purchase with { AcknowledgementState = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" };
        }
        if (row is null)
        {
            row = new Subscription
            {
                UserId = userId,
                PurchaseTokenHash = hash,
                ProductId = request.ProductId,
                BasePlanId = request.BasePlanId,
                ProtectedPurchaseToken = protector.Protect(request.PurchaseToken)
            };
            db.Subscriptions.Add(row);
        }
        Apply(row, purchase, item, time.GetUtcNow());
        row.LinkedPurchaseTokenHash = linkedHash;
        if (old is not null && old.Id != row.Id)
        {
            var was = HasEntitlement(old, time.GetUtcNow());
            old.Status = SubscriptionStatus.Revoked;
            old.LastEventAt = time.GetUtcNow();
            if (was) Audit(old, false);
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await EntitlementAsync(userId, ct);
    }

    public async Task RefreshAsync(string hash, DateTimeOffset eventAt, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(ct);
        var row = await db.Subscriptions.SingleOrDefaultAsync(x => x.PurchaseTokenHash == hash, ct);
        if (row is not null && row.Status != SubscriptionStatus.Revoked && row.ProtectedPurchaseToken.Length > 0)
        {
            await db.Entry(row).ReloadAsync(ct);
            if (row.Status == SubscriptionStatus.Revoked)
            {
                await transaction.CommitAsync(ct);
                return;
            }
            PlaySubscription purchase;
            try
            {
                purchase = await play.GetSubscriptionV2(BillingTokens.Package, protector.Unprotect(row.ProtectedPurchaseToken), ct);
            }
            catch (Exception e) when (row.ExpiresAt <= time.GetUtcNow() &&
                (e is KeyNotFoundException || e is HttpRequestException { StatusCode: System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Gone }))
            {
                if (row.Status is SubscriptionStatus.Active or SubscriptionStatus.InGracePeriod or SubscriptionStatus.Canceled) Audit(row, false);
                row.Status = SubscriptionStatus.Expired;
                row.AutoRenewing = false;
                row.LastEventAt = time.GetUtcNow();
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return;
            }
            var item = purchase.LineItems.FirstOrDefault(x => x.ProductId == row.ProductId && x.OfferDetails?.BasePlanId == row.BasePlanId);
            if (item is null) throw new InvalidOperationException("Play product changed unexpectedly.");
            // Always read current store state, even when deliveries arrive out of order.
            Apply(row, purchase, item, eventAt > row.LastEventAt ? eventAt : row.LastEventAt);
            await db.SaveChangesAsync(ct);
        }
        await transaction.CommitAsync(ct);
    }

    private void Apply(Subscription row, PlaySubscription purchase, PlayLineItem item, DateTimeOffset eventAt)
    {
        var before = row.Status is SubscriptionStatus.Active or SubscriptionStatus.InGracePeriod or SubscriptionStatus.Canceled;
        // New rows have no event timestamp and must produce a grant audit.
        before &= row.LastEventAt != default;
        row.Status = State(purchase.SubscriptionState);
        row.ExpiresAt = item.ExpiryTime.ToUniversalTime();
        if (row.ExpiresAt <= time.GetUtcNow() && row.Status != SubscriptionStatus.Revoked) row.Status = SubscriptionStatus.Expired;
        row.AutoRenewing = item.AutoRenewingPlan?.AutoRenewEnabled == true;
        row.Acknowledged = purchase.AcknowledgementState == "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
        row.Environment = purchase.TestPurchase is null ? BillingEnvironment.Production : BillingEnvironment.Test;
        row.LastEventAt = eventAt.ToUniversalTime();
        var after = HasEntitlement(row, time.GetUtcNow());
        if (before != after) Audit(row, after);
    }

    public static SubscriptionStatus State(string state) => state switch
    {
        "SUBSCRIPTION_STATE_ACTIVE" => SubscriptionStatus.Active,
        "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" => SubscriptionStatus.InGracePeriod,
        "SUBSCRIPTION_STATE_ON_HOLD" => SubscriptionStatus.OnHold,
        "SUBSCRIPTION_STATE_PAUSED" => SubscriptionStatus.Paused,
        "SUBSCRIPTION_STATE_CANCELED" => SubscriptionStatus.Canceled,
        "SUBSCRIPTION_STATE_REVOKED" => SubscriptionStatus.Revoked,
        _ => SubscriptionStatus.Expired,
    };

    private void Audit(Subscription row, bool grant)
    {
        if (row.Id == Guid.Empty) row.Id = Guid.CreateVersion7();
        db.AuditLogs.Add(new AuditLog
        {
            ActorId = null,
            TargetId = row.Id,
            TargetType = "subscription",
            Action = grant ? "subscription.granted" : "subscription.revoked"
        });
    }

    private Task LockAsync(CancellationToken ct) => db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(505051)", ct);
}
