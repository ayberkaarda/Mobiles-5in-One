package app.cetele.server.billing

import app.cetele.server.billing.play.PlayAckResult
import app.cetele.server.billing.play.PlayDeveloperApi
import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID

/** The verdict on a purchase Play confirmed, before it is bound to a shop (ADR-0031 link step 5). */
sealed interface PurchaseCheck {
    data class Valid(
        val state: SubscriptionState,
    ) : PurchaseCheck

    data class Refused(
        val code: ProblemCode,
        val reason: String,
    ) : PurchaseCheck

    companion object {
        fun of(
            purchase: PlaySubscriptionPurchase,
            shopId: UUID,
            productId: String,
        ): PurchaseCheck {
            if (purchase.lineItemFor(productId) == null) return Refused(ProblemCode.BILLING_PURCHASE_INVALID, "wrong_product")
            val account = purchase.obfuscatedExternalAccountId ?: return Refused(ProblemCode.BILLING_PURCHASE_INVALID, "no_account_id")
            if (account != PurchaseTokens.obfuscatedAccountId(shopId)) return Refused(ProblemCode.BILLING_TOKEN_IN_USE, "other_shop")
            val state =
                SubscriptionState.fromPlay(purchase.subscriptionState)
                    ?: return Refused(ProblemCode.BILLING_PURCHASE_INVALID, "unspecified_state")
            if (state == SubscriptionState.EXPIRED) return Refused(ProblemCode.BILLING_PURCHASE_INVALID, "dead_token")
            return Valid(state)
        }
    }
}

/** What happened when a new token was offered to a shop. */
sealed interface InsertResult {
    /** The hash was already stored (a concurrent link won); handle it as a repeat link. */
    data class Existing(
        val ref: SubscriptionRef,
    ) : InsertResult

    data class Inserted(
        val key: SubscriptionKey,
        val replaced: Boolean,
    ) : InsertResult

    /** Only replacements were allowed and the token replaces nothing of this shop. */
    data object NotAReplacement : InsertResult
}

/**
 * Every write to `subscriptions`, shared by the link endpoint, the RTDN processor and the sweep.
 * Each write runs in its own transaction under the billing lock of the shop and ends with the plan
 * recomputation; Play is never called while the lock is held.
 */
@Component
class SubscriptionWriter(
    private val subscriptions: SubscriptionRepository,
    private val index: SubscriptionIndex,
    private val entitlement: EntitlementService,
    private val cipher: PurchaseTokenCipher,
    private val settings: BillingSettings,
    private val play: PlayDeveloperApi,
    transactionManager: PlatformTransactionManager,
) {
    // Own transactions even inside a job-lock transaction: a refused write must not doom the job run.
    private val tx =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }
    private val log = LoggerFactory.getLogger(SubscriptionWriter::class.java)

    /**
     * Binds a new token to [shopId] (link step 6). A `linkedPurchaseToken` naming the current row
     * of this shop replaces it; one naming another shop's row is `token_in_use`. Otherwise a current
     * row that still entitles is `already_subscribed` and one that does not is superseded.
     * Throws `DataIntegrityViolationException` when a concurrent call stored the same token first.
     */
    fun insert(
        shopId: UUID,
        token: String,
        purchase: PlaySubscriptionPurchase,
        state: SubscriptionState,
        linkedBy: UUID?,
        now: Instant,
        reason: PlanChangeReason,
        replacementOnly: Boolean,
        readAt: Instant = now,
    ): InsertResult =
        checkNotNull(
            tx.execute {
                val shop = entitlement.lock(shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND, "shop gone")
                val hash = PurchaseTokens.hash(token)
                index.byTokenHash(hash)?.let { return@execute InsertResult.Existing(it) }
                val linkedRef = purchase.linkedPurchaseToken?.let { index.byTokenHash(PurchaseTokens.hash(it)) }
                if (linkedRef != null && linkedRef.shopId != shopId) {
                    throw ProblemException(ProblemCode.BILLING_TOKEN_IN_USE, "linked token of another shop")
                }
                val replaced = linkedRef?.takeIf { it.current }?.let { subscriptions.lockInShop(shopId, it.id) }
                if (replacementOnly && replaced == null) return@execute InsertResult.NotAReplacement
                val current = subscriptions.findCurrent(shopId)
                if (current != null && current.subscriptionId != replaced?.subscriptionId) {
                    if (current.entitles(now)) throw ProblemException(ProblemCode.BILLING_ALREADY_SUBSCRIBED, "entitling row present")
                    current.supersede(now, replaced = false)
                }
                replaced?.supersede(now, replaced = true)
                index.flush()
                val row =
                    Subscription(
                        boundShopId = shopId,
                        purchaseTokenHash = hash,
                        purchaseTokenEnc = cipher.encrypt(token),
                        productId = settings.productId,
                        state = state,
                        linkedBy = linkedBy ?: replaced?.linkedBy,
                        linkedAt = now,
                        lastVerifiedAt = readAt,
                    )
                row.apply(purchase, now, readAt)
                val saved = subscriptions.save(row)
                index.flush()
                replaced?.replacedBy = saved.subscriptionId
                entitlement.recompute(shop, now, reason)
                InsertResult.Inserted(SubscriptionKey(shopId, saved.subscriptionId), replaced != null)
            },
        )

    /**
     * Applies a Play answer unless [readAt] predates the stored verification, checked under the lock.
     * A `null` [purchase] (Play no longer knows it) only stamps the check; [now] is the write and entitlement time.
     */
    fun refresh(
        key: SubscriptionKey,
        purchase: PlaySubscriptionPurchase?,
        now: Instant,
        reason: PlanChangeReason,
        notificationType: Int? = null,
        readAt: Instant = now,
    ): SubscriptionState? =
        tx.execute {
            val shop = entitlement.lock(key.shopId) ?: return@execute null
            val row = subscriptions.lockInShop(key.shopId, key.id) ?: return@execute null
            if (row.lastVerifiedAt > readAt) return@execute row.state
            notificationType?.let { row.lastNotificationType = it }
            if (purchase != null) {
                row.apply(purchase, now, readAt)
            } else {
                row.lastVerifiedAt = readAt
                row.updatedAt = now
            }
            entitlement.recompute(shop, now, reason)
            row.state
        }

    /** A Play-confirmed revocation stays sticky; an answer older than the stored verification is ignored. */
    fun revoke(
        key: SubscriptionKey,
        now: Instant,
        reason: PlanChangeReason,
        notificationType: Int? = null,
        readAt: Instant = now,
    ): Boolean =
        tx.execute {
            val shop = entitlement.lock(key.shopId) ?: return@execute false
            val row = subscriptions.lockInShop(key.shopId, key.id) ?: return@execute false
            if (row.lastVerifiedAt > readAt) return@execute false
            notificationType?.let { row.lastNotificationType = it }
            row.revoke(now)
            row.lastVerifiedAt = readAt
            entitlement.recompute(shop, now, reason)
            true
        } == true

    /** Recomputes the plan without a Play answer (time alone can end an entitlement). */
    fun recompute(
        shopId: UUID,
        now: Instant,
        reason: PlanChangeReason,
    ) {
        tx.executeWithoutResult { entitlement.recompute(shopId, now, reason) }
    }

    /** The stored token of a row, or `null` when it is gone or unreadable (e.g. an ephemeral key after a restart). */
    fun token(key: SubscriptionKey): String? =
        tx.execute {
            subscriptions.lockInShop(key.shopId, key.id)?.purchaseTokenEnc?.let { cipher.decrypt(it) }
        }

    /**
     * Acknowledges an entitling purchase that is not acknowledged yet (link step 7 and the sweep).
     * Never runs inside a transaction; a failure is logged and retried by the sweep.
     */
    fun acknowledgeIfDue(
        key: SubscriptionKey,
        token: String,
        now: Instant,
    ): Boolean {
        val due =
            tx.execute {
                subscriptions.lockInShop(key.shopId, key.id)?.let { row ->
                    row.acknowledgedAt == null && row.supersededAt == null && row.state in SubscriptionIndex.ACKNOWLEDGEABLE
                }
            } == true
        if (!due) return false
        return when (val result = play.acknowledge(settings.productId, token)) {
            PlayAckResult.Acknowledged -> {
                tx.executeWithoutResult {
                    subscriptions.lockInShop(key.shopId, key.id)?.let { row ->
                        row.acknowledgedAt = now
                        row.updatedAt = now
                    }
                }
                log.info("Billing acknowledge shop={} outcome=acknowledged", key.shopId)
                true
            }

            PlayAckResult.NotFound -> {
                log.warn("Billing acknowledge shop={} outcome=not_found", key.shopId)
                false
            }

            is PlayAckResult.Unavailable -> {
                log.warn("Billing acknowledge shop={} outcome=unavailable reason={}", key.shopId, result.reason)
                false
            }
        }
    }
}
