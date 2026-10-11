package app.cetele.android.feature.billing.gateway

import android.app.Activity
import kotlinx.coroutines.flow.Flow

/**
 * The store side of billing: Google Play in release builds, a local fake in debug builds without a Play
 * account (ADR-0004 G1). The gateway never acknowledges a purchase; the server does so after it verified and
 * bound the token (ADR-0031).
 */
interface BillingGateway {
    /** Purchases reported by the store after a purchase flow, including later `PENDING` to `PURCHASED` changes. */
    val purchaseUpdates: Flow<StoreResult<List<StorePurchase>>>

    suspend fun connect(): StoreResult<Unit>

    /** Base plans of Çetele Pro with the store's formatted prices; no price is known to the app. */
    suspend fun queryOffers(): StoreResult<List<ProOffer>>

    /** Starts the store purchase sheet; the outcome arrives on [purchaseUpdates]. */
    suspend fun launchPurchase(
        activity: Activity,
        request: PurchaseRequest,
    ): StoreResult<Unit>

    /** Current subscription purchases of the store account (restore). */
    suspend fun queryPurchases(): StoreResult<List<StorePurchase>>
}

sealed interface StoreResult<out T> {
    data class Ok<T>(
        val value: T,
    ) : StoreResult<T>

    data class Failed(
        val reason: StoreFailure,
    ) : StoreResult<Nothing>
}

enum class StoreFailure {
    /** Play is missing, signed out, disconnected or the product is not configured. */
    UNAVAILABLE,

    /** The person closed the purchase sheet. */
    CANCELED,

    /** The store account already owns the subscription; a restore links it. */
    ALREADY_OWNED,

    /** Any other store error. */
    ERROR,
}

/** One base plan offer of Çetele Pro. */
data class ProOffer(
    val basePlanId: String,
    val offerToken: String,
    val formattedPrice: String,
    val billingPeriod: String,
) {
    override fun toString(): String = "ProOffer(basePlanId=$basePlanId, billingPeriod=$billingPeriod)"
}

enum class StorePurchaseState {
    PURCHASED,
    PENDING,
    UNSPECIFIED,
}

/** A store purchase; its token and obfuscated account id are never printed. */
data class StorePurchase(
    val purchaseToken: String,
    val products: List<String>,
    val state: StorePurchaseState,
    val obfuscatedAccountId: String?,
) {
    override fun toString(): String = "StorePurchase(products=$products, state=$state)"
}

/** A purchase for [shopId]; [replacingToken] is the current purchase when switching between base plans. */
data class PurchaseRequest(
    val shopId: String,
    val offer: ProOffer,
    val replacingToken: String? = null,
) {
    override fun toString(): String =
        "PurchaseRequest(basePlanId=${offer.basePlanId}, replacing=${replacingToken != null})"
}
