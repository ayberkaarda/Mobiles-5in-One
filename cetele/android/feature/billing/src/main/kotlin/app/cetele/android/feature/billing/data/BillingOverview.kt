package app.cetele.android.feature.billing.data

import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.network.dto.billing.BillingState
import app.cetele.android.core.network.dto.billing.SubscriptionState
import app.cetele.android.core.network.dto.billing.SubscriptionView
import java.time.Instant
import java.time.YearMonth
import app.cetele.android.core.network.dto.ShopPlan as WirePlan

/** What the billing screen shows about a shop's plan; built from `GET billing` only. */
data class BillingOverview(
    val plan: ShopPlan,
    val month: YearMonth?,
    val customers: Usage,
    val photos: Usage,
    val sms: Usage,
    val subscription: SubscriptionSummary?,
) {
    /** True when the current subscription gives PRO now; the owner then manages it instead of buying. */
    val entitled: Boolean get() = subscription?.entitled == true
}

/** Used amount against a limit; `limit == null` means unlimited. */
data class Usage(
    val used: Int,
    val limit: Int?,
) {
    val unlimited: Boolean get() = limit == null
}

data class SubscriptionSummary(
    val status: SubscriptionStatus,
    val basePlanId: String?,
    val entitled: Boolean,
    val expiresAt: Instant?,
    val autoRenewing: Boolean,
    val testPurchase: Boolean,
)

/** Screen-level meaning of each stored subscription state (ADR-0031 state table). */
enum class SubscriptionStatus {
    /** Payment not completed yet; the shop stays FREE. */
    PENDING,

    /** Paid and renewing. */
    ACTIVE,

    /** Payment failed, Play keeps PRO while it retries. */
    GRACE,

    /** Payment failed for longer; FREE until fixed in Play. */
    ON_HOLD,

    /** Paused by the owner in Play; FREE until it resumes. */
    PAUSED,

    /** Cancelled; PRO until the paid period ends. */
    CANCELED,

    /** Ended; a new purchase is needed. */
    EXPIRED,

    /** Refunded or revoked; never entitles again. */
    REVOKED,

    /** Superseded or orphaned; not expected as the current row, shown as ended. */
    ENDED,
}

object BillingStateMapper {
    fun map(state: BillingState): BillingOverview =
        BillingOverview(
            plan =
                when (state.plan) {
                    WirePlan.FREE -> ShopPlan.FREE
                    WirePlan.PRO -> ShopPlan.PRO
                },
            month = runCatching { YearMonth.parse(state.usage.month) }.getOrNull(),
            customers = Usage(state.usage.customers, state.limits.customers),
            photos = Usage(state.usage.photos, state.limits.photosPerMonth),
            sms = Usage(state.usage.sms, state.limits.smsPerMonth),
            subscription = state.subscription?.let(::summary),
        )

    fun status(state: SubscriptionState): SubscriptionStatus =
        when (state) {
            SubscriptionState.PENDING -> SubscriptionStatus.PENDING
            SubscriptionState.ACTIVE -> SubscriptionStatus.ACTIVE
            SubscriptionState.IN_GRACE_PERIOD -> SubscriptionStatus.GRACE
            SubscriptionState.ON_HOLD -> SubscriptionStatus.ON_HOLD
            SubscriptionState.PAUSED -> SubscriptionStatus.PAUSED
            SubscriptionState.CANCELED -> SubscriptionStatus.CANCELED
            SubscriptionState.EXPIRED -> SubscriptionStatus.EXPIRED
            SubscriptionState.REVOKED -> SubscriptionStatus.REVOKED
            SubscriptionState.REPLACED, SubscriptionState.ORPHANED -> SubscriptionStatus.ENDED
        }

    private fun summary(view: SubscriptionView): SubscriptionSummary =
        SubscriptionSummary(
            status = status(view.state),
            basePlanId = view.basePlanId,
            entitled = view.entitled,
            expiresAt = view.expiresAt,
            autoRenewing = view.autoRenewing,
            testPurchase = view.testPurchase,
        )
}
