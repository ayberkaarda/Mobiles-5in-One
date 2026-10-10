@file:UseSerializers(InstantSerializer::class)

package app.cetele.android.core.network.dto.billing

import app.cetele.android.core.network.dto.InstantSerializer
import app.cetele.android.core.network.dto.ShopPlan
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.time.Instant

/** Body of `POST /v1/shops/{shopId}/billing/link`; the token is never logged or printed. */
@Serializable
data class LinkPurchaseRequest(
    val productId: String,
    val purchaseToken: String,
) {
    override fun toString(): String = "LinkPurchaseRequest(productId=$productId, purchaseToken=<redacted>)"
}

/** `GET /v1/shops/{shopId}/billing` and the answer of a successful link. */
@Serializable
data class BillingState(
    val plan: ShopPlan,
    val limits: PlanLimitsView,
    val usage: PlanUsageView,
    val subscription: SubscriptionView? = null,
)

/** Limits of the current plan; `customers` is `null` when the plan has no customer limit. */
@Serializable
data class PlanLimitsView(
    val customers: Int? = null,
    val photosPerMonth: Int,
    val smsPerMonth: Int,
)

/** Usage the limits are checked against; `month` is `yyyy-MM` in Europe/Istanbul. */
@Serializable
data class PlanUsageView(
    val month: String,
    val customers: Int,
    val photos: Int,
    val sms: Int,
)

@Serializable
data class SubscriptionView(
    val productId: String,
    val basePlanId: String? = null,
    val state: SubscriptionState,
    val entitled: Boolean,
    val expiresAt: Instant? = null,
    val autoRenewing: Boolean,
    val testPurchase: Boolean,
    val linkedAt: Instant,
)

/** Stored subscription state (ADR-0031); `REPLACED` and `ORPHANED` are never the current row. */
@Serializable
enum class SubscriptionState {
    PENDING,
    ACTIVE,
    IN_GRACE_PERIOD,
    ON_HOLD,
    PAUSED,
    CANCELED,
    EXPIRED,
    REVOKED,
    REPLACED,
    ORPHANED,
}
