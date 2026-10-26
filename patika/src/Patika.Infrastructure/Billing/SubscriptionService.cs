using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Patika.Contracts.Subscriptions;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Infrastructure.Billing;

public sealed class PurchaseRejectedException(string code) : Exception(code)
{
    public string Code => Message;
}

public sealed class SubscriptionService(PatikaDbContext db, IPlayDeveloperApi play, IDataProtectionProvider protection, TimeProvider time,
    BillingOptions options)
{
    private static bool IsPlan(string? basePlanId) => basePlanId is "aylik" or "yillik";
    private readonly IDataProtector protector = protection.CreateProtector("Patika.Play.PurchaseToken.v1");

    public async Task<EntitlementResponse> EntitlementAsync(Guid userId, CancellationToken ct = default)
    {
        var now = time.GetUtcNow();
        var rows = await db.Subscriptions.AsNoTracking().Where(x => x.UserId == userId).ToListAsync(ct);
        // A test row the policy does not honour is not shown as the current subscription either.
        var row = rows.Where(x => options.AllowTestPurchases || x.Environment != BillingEnvironment.Test)
            .OrderByDescending(x => HasEntitlement(x, now, options.AllowTestPurchases)).ThenByDescending(x => x.ExpiresAt).FirstOrDefault();
        return new(row is not null && HasEntitlement(row, now, options.AllowTestPurchases), row?.ExpiresAt, row?.Status.ToString());
    }

    public static bool HasEntitlement(Subscription row, DateTimeOffset now, bool allowTestPurchases) => row.ExpiresAt > now &&
        (allowTestPurchases || row.Environment != BillingEnvironment.Test) &&
        row.Status is SubscriptionStatus.Active or SubscriptionStatus.InGracePeriod or SubscriptionStatus.Canceled;

    /// <param name="accountId">The caller's <see cref="BillingAccountIds"/> value; Play must return the same one with the purchase.</param>
    public async Task<EntitlementResponse> VerifyAsync(Guid userId, string accountId, VerifySubscriptionRequest request, CancellationToken ct = default)
    {
        if (request.ProductId != BillingTokens.Product || !IsPlan(request.BasePlanId) ||
            string.IsNullOrWhiteSpace(request.PurchaseToken) || request.PurchaseToken.Length > 4096)
            throw new PurchaseRejectedException("invalid_purchase");
        var hash = BillingTokens.Hash(request.PurchaseToken);
        // A token already bound to someone else is refused without a store call.
        var bound = await db.Subscriptions.AsNoTracking().Where(x => x.PurchaseTokenHash == hash)
            .Select(x => new { x.Id, x.UserId }).SingleOrDefaultAsync(ct);
        if (bound is not null && bound.UserId != userId) throw await ClaimRejectedAsync(userId, bound.Id, hash, null, ct);

        // The store is read before any lock is taken, so a slow Play response holds nothing but this request.
        PlaySubscription purchase;
        try { purchase = await play.GetSubscriptionV2(BillingTokens.Package, request.PurchaseToken, ct); }
        catch (Exception e) when (IsNotFound(e)) { throw new PurchaseRejectedException("purchase_not_found"); }
        if (purchase.TestPurchase is not null && !options.AllowTestPurchases) throw new PurchaseRejectedException("test_purchase_not_allowed");
        var item = purchase.LineItems.FirstOrDefault(x => x.ProductId == request.ProductId && x.OfferDetails?.BasePlanId == request.BasePlanId);
        if (item is null || item.ExpiryTime <= time.GetUtcNow() || purchase.SubscriptionState is not
            ("SUBSCRIPTION_STATE_ACTIVE" or "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"))
            throw new PurchaseRejectedException("invalid_purchase");
        // Play echoes the account id the app set at purchase time; a missing or different one is someone else's purchase,
        // which also covers a chain whose predecessors were never presented here.
        if (!accountId.Equals(purchase.ExternalAccountIdentifiers?.ObfuscatedExternalAccountId, StringComparison.Ordinal))
            throw await ClaimRejectedAsync(userId, bound?.Id, hash, null, ct);
        var linkedHash = purchase.LinkedPurchaseToken is { Length: > 0 } linked ? BillingTokens.Hash(linked) : null;

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(ct, hash, linkedHash);
        var row = await db.Subscriptions.SingleOrDefaultAsync(x => x.PurchaseTokenHash == hash, ct);
        if (row is not null) await db.Entry(row).ReloadAsync(ct);
        if (row is not null && row.UserId != userId) throw await ClaimRejectedAsync(userId, row.Id, hash, transaction, ct);
        var old = linkedHash is null ? null : await db.Subscriptions.SingleOrDefaultAsync(x => x.PurchaseTokenHash == linkedHash, ct);
        if (old is not null) await db.Entry(old).ReloadAsync(ct);
        if (old is not null && old.UserId != userId) throw await ClaimRejectedAsync(userId, old.Id, hash, transaction, ct);
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
        row.BasePlanId = request.BasePlanId;
        Apply(row, purchase, item, time.GetUtcNow(), userId);
        row.LinkedPurchaseTokenHash = linkedHash;
        if (old is not null && old.Id != row.Id)
        {
            var was = HasEntitlement(old, time.GetUtcNow(), options.AllowTestPurchases);
            old.Status = SubscriptionStatus.Revoked;
            old.LastEventAt = time.GetUtcNow();
            if (was) Audit(old, false, userId);
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return await EntitlementAsync(userId, ct);
    }

    public async Task RefreshAsync(string hash, DateTimeOffset eventAt, CancellationToken ct = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        // The same per-token lock as verification: a refresh of one token never waits on another.
        await LockAsync(ct, hash);
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
            catch (Exception e) when (row.ExpiresAt <= time.GetUtcNow() && IsNotFound(e))
            {
                if (HasEntitlement(row, row.ExpiresAt.AddTicks(-1), options.AllowTestPurchases)) Audit(row, false, null);
                row.Status = SubscriptionStatus.Expired;
                row.AutoRenewing = false;
                row.LastEventAt = time.GetUtcNow();
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return;
            }
            // A base plan change under the same token follows Play as long as the new plan is one of ours.
            var item = purchase.LineItems.Where(x => x.ProductId == row.ProductId && IsPlan(x.OfferDetails?.BasePlanId))
                .OrderByDescending(x => x.OfferDetails!.BasePlanId == row.BasePlanId).ThenByDescending(x => x.ExpiryTime).FirstOrDefault()
                ?? throw new InvalidOperationException("Play product changed unexpectedly.");
            row.BasePlanId = item.OfferDetails!.BasePlanId;
            // Always read current store state, even when deliveries arrive out of order.
            Apply(row, purchase, item, eventAt > row.LastEventAt ? eventAt : row.LastEventAt, null);
            await db.SaveChangesAsync(ct);
        }
        await transaction.CommitAsync(ct);
    }

    private static bool IsNotFound(Exception e) => e is KeyNotFoundException ||
        e is HttpRequestException { StatusCode: HttpStatusCode.NotFound or HttpStatusCode.Gone };

    private void Apply(Subscription row, PlaySubscription purchase, PlayLineItem item, DateTimeOffset eventAt, Guid? actorId)
    {
        // New rows have no event timestamp and must produce a grant audit.
        var before = row.LastEventAt != default && HasEntitlement(row, row.ExpiresAt.AddTicks(-1), options.AllowTestPurchases);
        row.Status = State(purchase.SubscriptionState);
        row.ExpiresAt = item.ExpiryTime.ToUniversalTime();
        if (row.ExpiresAt <= time.GetUtcNow() && row.Status != SubscriptionStatus.Revoked) row.Status = SubscriptionStatus.Expired;
        row.AutoRenewing = item.AutoRenewingPlan?.AutoRenewEnabled == true;
        row.Acknowledged = purchase.AcknowledgementState == "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
        row.Environment = purchase.TestPurchase is null ? BillingEnvironment.Production : BillingEnvironment.Test;
        row.LastEventAt = eventAt.ToUniversalTime();
        var after = HasEntitlement(row, time.GetUtcNow(), options.AllowTestPurchases);
        if (before != after) Audit(row, after, actorId);
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

    private void Audit(Subscription row, bool grant, Guid? actorId)
    {
        if (row.Id == Guid.Empty) row.Id = Guid.CreateVersion7();
        db.AuditLogs.Add(new AuditLog
        {
            ActorId = actorId,
            TargetId = row.Id,
            TargetType = "subscription",
            Action = grant ? "subscription.granted" : "subscription.revoked"
        });
    }

    /// <summary>
    /// Records a refused claim (foreign, purged or unbound purchase) outside the verification transaction, so a stolen or
    /// shared token shows up in the audit log. Only a short prefix of the token hash is kept.
    /// </summary>
    private async Task<PurchaseRejectedException> ClaimRejectedAsync(Guid userId, Guid? targetId, string hash, IDbContextTransaction? transaction,
        CancellationToken ct)
    {
        if (transaction is not null) await transaction.RollbackAsync(ct);
        db.AuditLogs.Add(new AuditLog
        {
            ActorId = userId,
            TargetId = targetId,
            TargetType = "subscription",
            Action = "subscription.claim_rejected",
            DetailsJson = JsonSerializer.Serialize(new { tokenHash = hash[..12] }),
        });
        await db.SaveChangesAsync(ct);
        return new PurchaseRejectedException("purchase_owned_elsewhere");
    }

    // Per-token transaction locks, taken in one order so a token and its predecessor never deadlock.
    private async Task LockAsync(CancellationToken ct, params string?[] hashes)
    {
        foreach (var key in hashes.OfType<string>().Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))
            await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", ct);
    }
}
