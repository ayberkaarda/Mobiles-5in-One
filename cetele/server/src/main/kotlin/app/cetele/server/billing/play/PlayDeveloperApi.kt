package app.cetele.server.billing.play

import java.time.Instant

/**
 * The two Google Play Developer API calls billing needs (ADR-0031): `purchases.subscriptionsv2.get`
 * and `purchases.subscriptions.acknowledge`. Implementations never retry inside a call and never
 * log the purchase token.
 */
interface PlayDeveloperApi {
    fun getSubscription(purchaseToken: String): PlaySubscriptionResult

    fun acknowledge(
        productId: String,
        purchaseToken: String,
    ): PlayAckResult
}

sealed interface PlaySubscriptionResult {
    data class Found(
        val purchase: PlaySubscriptionPurchase,
    ) : PlaySubscriptionResult

    /** Google answered 400, 404 or 410: the token is not a purchase Play knows. */
    data object NotFound : PlaySubscriptionResult

    /** Timeout, transport error, 5xx, or 401/403 from Google: Play could not be asked. */
    data class Unavailable(
        val reason: String,
    ) : PlaySubscriptionResult
}

sealed interface PlayAckResult {
    data object Acknowledged : PlayAckResult

    data object NotFound : PlayAckResult

    data class Unavailable(
        val reason: String,
    ) : PlayAckResult
}

/** One `lineItems[]` entry of a `SubscriptionPurchaseV2`. */
data class PlayLineItem(
    val productId: String,
    val expiryTime: Instant?,
    val basePlanId: String?,
    val autoRenewEnabled: Boolean,
)

/**
 * The fields of a `SubscriptionPurchaseV2` that billing reads. [linkedPurchaseToken] is a purchase
 * token, so [toString] never prints it.
 */
class PlaySubscriptionPurchase(
    val subscriptionState: String,
    val acknowledgementState: String,
    val linkedPurchaseToken: String?,
    val obfuscatedExternalAccountId: String?,
    val testPurchase: Boolean,
    val lineItems: List<PlayLineItem>,
) {
    val acknowledgementPending: Boolean get() = acknowledgementState == ACKNOWLEDGEMENT_PENDING

    /** The line item of [productId] with the latest expiry, or `null` when the purchase has none. */
    fun lineItemFor(productId: String): PlayLineItem? =
        lineItems.filter { it.productId == productId }.maxByOrNull { it.expiryTime ?: Instant.MIN }

    fun copy(
        subscriptionState: String = this.subscriptionState,
        acknowledgementState: String = this.acknowledgementState,
        linkedPurchaseToken: String? = this.linkedPurchaseToken,
        obfuscatedExternalAccountId: String? = this.obfuscatedExternalAccountId,
        testPurchase: Boolean = this.testPurchase,
        lineItems: List<PlayLineItem> = this.lineItems,
    ) = PlaySubscriptionPurchase(
        subscriptionState,
        acknowledgementState,
        linkedPurchaseToken,
        obfuscatedExternalAccountId,
        testPurchase,
        lineItems,
    )

    override fun toString(): String = "PlaySubscriptionPurchase(state=$subscriptionState, acknowledgement=$acknowledgementState)"

    companion object {
        const val STATE_UNSPECIFIED = "SUBSCRIPTION_STATE_UNSPECIFIED"
        const val STATE_PENDING = "SUBSCRIPTION_STATE_PENDING"
        const val STATE_ACTIVE = "SUBSCRIPTION_STATE_ACTIVE"
        const val STATE_PAUSED = "SUBSCRIPTION_STATE_PAUSED"
        const val STATE_IN_GRACE_PERIOD = "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
        const val STATE_ON_HOLD = "SUBSCRIPTION_STATE_ON_HOLD"
        const val STATE_CANCELED = "SUBSCRIPTION_STATE_CANCELED"
        const val STATE_EXPIRED = "SUBSCRIPTION_STATE_EXPIRED"
        const val STATE_PENDING_PURCHASE_CANCELED = "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"
        const val ACKNOWLEDGEMENT_PENDING = "ACKNOWLEDGEMENT_STATE_PENDING"
        const val ACKNOWLEDGED = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"
    }
}
