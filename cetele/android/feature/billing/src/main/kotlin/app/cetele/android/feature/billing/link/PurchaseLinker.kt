package app.cetele.android.feature.billing.link

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.dto.billing.BillingState
import app.cetele.android.feature.billing.BillingProduct
import app.cetele.android.feature.billing.ObfuscatedAccountId
import app.cetele.android.feature.billing.gateway.BillingGateway
import app.cetele.android.feature.billing.gateway.StoreFailure
import app.cetele.android.feature.billing.gateway.StorePurchase
import app.cetele.android.feature.billing.gateway.StorePurchaseState
import app.cetele.android.feature.billing.gateway.StoreResult
import app.cetele.android.feature.billing.sha256Hex
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

sealed interface LinkOutcome {
    data class Linked(
        val state: BillingState,
    ) : LinkOutcome

    /** The server could not be reached or asked to wait; background work keeps trying with the same token. */
    data object Queued : LinkOutcome

    data class Refused(
        val code: String?,
    ) : LinkOutcome
}

/** Result of matching the store's purchases with the shops the user owns. */
data class RestoreReport(
    val outcomes: Map<String, LinkOutcome> = emptyMap(),
    val pendingShops: Set<String> = emptySet(),
    val purchases: Map<String, StorePurchase> = emptyMap(),
    val failure: StoreFailure? = null,
)

/**
 * Links Play purchases to shops (handoff 002, steps 4, 6 and 7). A purchase is linked only when it is
 * `PURCHASED` for Çetele Pro and its obfuscated account id is the value of a shop the user owns; the device
 * never acknowledges it.
 */
@Singleton
class PurchaseLinker
    @Inject
    constructor(
        private val client: BillingLinkClient,
        private val scheduler: BillingLinkScheduler,
        private val gateway: BillingGateway,
        private val shops: ShopRepository,
    ) {
        private val linkedThisSession = mutableSetOf<String>()

        suspend fun link(
            shopId: String,
            purchase: StorePurchase,
        ): LinkOutcome =
            when (val attempt = client.attempt(shopId, purchase.purchaseToken)) {
                is LinkAttempt.Linked -> {
                    synchronized(linkedThisSession) { linkedThisSession += key(purchase) }
                    LinkOutcome.Linked(attempt.state)
                }

                is LinkAttempt.Retry -> {
                    scheduler.enqueue(shopId, purchase.purchaseToken, attempt.retryAfterSeconds)
                    LinkOutcome.Queued
                }

                is LinkAttempt.Final -> {
                    LinkOutcome.Refused(attempt.code)
                }
            }

        /** Shops the user owns, by obfuscated account id. */
        suspend fun ownedShops(): Map<String, String> =
            shops
                .observeShops()
                .first()
                .filter { it.role == ShopRole.OWNER }
                .associate { ObfuscatedAccountId.of(it.id) to it.id }

        /** Restore on app start and when the billing screen opens: re-links every matching purchase. */
        suspend fun restore(): RestoreReport {
            val purchases =
                when (val result = gateway.queryPurchases()) {
                    is StoreResult.Failed -> return RestoreReport(failure = result.reason)
                    is StoreResult.Ok -> result.value
                }
            val owned = ownedShops()
            val outcomes = mutableMapOf<String, LinkOutcome>()
            val pending = mutableSetOf<String>()
            val current = mutableMapOf<String, StorePurchase>()
            for (purchase in purchases) {
                val shopId = shopFor(purchase, owned) ?: continue
                if (purchase.state == StorePurchaseState.PENDING) pending += shopId
                if (purchase.state == StorePurchaseState.PURCHASED) {
                    current[shopId] = purchase
                    val known = synchronized(linkedThisSession) { key(purchase) in linkedThisSession }
                    if (!known) outcomes[shopId] = link(shopId, purchase)
                }
            }
            return RestoreReport(outcomes, pending, current)
        }

        companion object {
            /** The owned shop a Çetele Pro purchase was made for, or `null`. */
            fun shopFor(
                purchase: StorePurchase,
                owned: Map<String, String>,
            ): String? =
                purchase.obfuscatedAccountId
                    ?.takeIf { BillingProduct.PRODUCT_ID in purchase.products }
                    ?.let(owned::get)

            private fun key(purchase: StorePurchase): String = sha256Hex(purchase.purchaseToken)
        }
    }
