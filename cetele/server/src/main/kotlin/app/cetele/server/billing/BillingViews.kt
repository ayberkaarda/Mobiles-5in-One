package app.cetele.server.billing

import app.cetele.server.tenancy.PlanLimits
import app.cetele.server.tenancy.shop.ShopPlan
import java.time.Instant

/** `GET /v1/shops/{shopId}/billing` and the answer of `POST .../billing/link` (handoff 002). */
data class BillingState(
    val plan: ShopPlan,
    val limits: PlanLimitsView,
    val usage: PlanUsageView,
    val subscription: SubscriptionView?,
)

/** The limits of [PlanLimits]; `customers` is `null` for unlimited. */
data class PlanLimitsView(
    val customers: Int?,
    val photosPerMonth: Int,
    val smsPerMonth: Int,
) {
    companion object {
        fun of(plan: ShopPlan): PlanLimitsView {
            val limits = PlanLimits.of(plan)
            return PlanLimitsView(
                customers = limits.customers.takeIf { it != Int.MAX_VALUE },
                photosPerMonth = limits.photosPerMonth,
                smsPerMonth = limits.smsPerMonth,
            )
        }
    }
}

/** This Istanbul month's use, the same numbers the limits are checked against. */
data class PlanUsageView(
    val month: String,
    val customers: Int,
    val photos: Int,
    val sms: Int,
)

/** The current subscription row; the purchase token and its hash are never part of it. */
data class SubscriptionView(
    val productId: String,
    val basePlanId: String?,
    val state: SubscriptionState,
    val entitled: Boolean,
    val expiresAt: Instant?,
    val autoRenewing: Boolean,
    val testPurchase: Boolean,
    val linkedAt: Instant,
) {
    companion object {
        fun of(
            row: Subscription,
            now: Instant,
        ) = SubscriptionView(
            productId = row.productId,
            basePlanId = row.basePlanId,
            state = row.state,
            entitled = row.entitles(now),
            expiresAt = row.expiresAt.takeIf { row.state != SubscriptionState.PENDING },
            autoRenewing = row.autoRenewing,
            testPurchase = row.testPurchase,
            linkedAt = row.linkedAt,
        )
    }
}
