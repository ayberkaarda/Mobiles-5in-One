package app.cetele.android.feature.billing

import android.app.Activity
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.dto.billing.BillingState
import app.cetele.android.core.network.dto.billing.PlanLimitsView
import app.cetele.android.core.network.dto.billing.PlanUsageView
import app.cetele.android.core.network.dto.billing.SubscriptionState
import app.cetele.android.core.network.dto.billing.SubscriptionView
import app.cetele.android.feature.billing.gateway.BillingGateway
import app.cetele.android.feature.billing.gateway.ProOffer
import app.cetele.android.feature.billing.gateway.PurchaseRequest
import app.cetele.android.feature.billing.gateway.StoreFailure
import app.cetele.android.feature.billing.gateway.StorePurchase
import app.cetele.android.feature.billing.gateway.StorePurchaseState
import app.cetele.android.feature.billing.gateway.StoreResult
import kotlinx.coroutines.flow.MutableSharedFlow
import java.time.Instant
import app.cetele.android.core.network.dto.ShopPlan as WirePlan

internal const val SHOP_ID = "01928c3e-5f6a-7b8c-9d0e-1f2a3b4c5d6e"
internal const val OTHER_SHOP_ID = "01928c3e-0000-7b8c-9d0e-1f2a3b4c5d6e"
internal const val SHOP_HASH = "775ddbc0c97c6683bb78cafdffea51471b53ceb7fbd89993ed36e130430db621"

internal fun shop(
    role: ShopRole = ShopRole.OWNER,
    id: String = SHOP_ID,
    plan: ShopPlan = ShopPlan.FREE,
): Shop = Shop(id, "Yılmaz Bakkal", ShopType.BAKKAL, "İstanbul", "Kadıköy", plan, role, Instant.EPOCH)

internal fun freeState(): BillingState =
    BillingState(
        plan = WirePlan.FREE,
        limits = PlanLimitsView(customers = 100, photosPerMonth = 200, smsPerMonth = 30),
        usage = PlanUsageView(month = "2026-10", customers = 42, photos = 7, sms = 3),
        subscription = null,
    )

internal fun subscription(
    state: SubscriptionState = SubscriptionState.ACTIVE,
    entitled: Boolean = true,
    basePlanId: String? = "monthly",
): SubscriptionView =
    SubscriptionView(
        productId = "cetele_pro",
        basePlanId = basePlanId,
        state = state,
        entitled = entitled,
        expiresAt = if (state == SubscriptionState.PENDING) null else Instant.parse("2026-11-11T09:30:00Z"),
        autoRenewing = state == SubscriptionState.ACTIVE,
        testPurchase = true,
        linkedAt = Instant.parse("2026-10-11T09:30:05Z"),
    )

internal fun proState(subscription: SubscriptionView = subscription()): BillingState =
    BillingState(
        plan = if (subscription.entitled) WirePlan.PRO else WirePlan.FREE,
        limits = PlanLimitsView(customers = null, photosPerMonth = 2000, smsPerMonth = 500),
        usage = PlanUsageView(month = "2026-10", customers = 137, photos = 12, sms = 3),
        subscription = subscription,
    )

internal fun problem(
    status: Int,
    code: String,
    retryAfter: Int? = null,
): ApiResult.Failure.Problem =
    ApiResult.Failure.Problem(ProblemDetail(title = "Rejected", status = status, code = code), retryAfter)

internal fun purchase(
    shopId: String = SHOP_ID,
    state: StorePurchaseState = StorePurchaseState.PURCHASED,
    token: String = "fake.sub.active.$shopId",
): StorePurchase = StorePurchase(token, listOf("cetele_pro"), state, ObfuscatedAccountId.of(shopId))

internal val monthly = ProOffer("monthly", "offer-monthly", "₺49,99", "P1M")
internal val yearly = ProOffer("yearly", "offer-yearly", "₺499,99", "P1Y")

/** Scriptable store for view model and linker tests; it has no acknowledge operation, like the real gateway. */
internal class TestGateway : BillingGateway {
    override val purchaseUpdates = MutableSharedFlow<StoreResult<List<StorePurchase>>>(extraBufferCapacity = 8)
    var offers: StoreResult<List<ProOffer>> = StoreResult.Ok(listOf(monthly, yearly))
    var owned: StoreResult<List<StorePurchase>> = StoreResult.Ok(emptyList())
    var launchResult: StoreResult<Unit> = StoreResult.Ok(Unit)
    val launches = mutableListOf<PurchaseRequest>()
    var offerQueries = 0
    var purchaseQueries = 0

    override suspend fun connect(): StoreResult<Unit> = StoreResult.Ok(Unit)

    override suspend fun queryOffers(): StoreResult<List<ProOffer>> {
        offerQueries++
        return offers
    }

    override suspend fun launchPurchase(
        activity: Activity,
        request: PurchaseRequest,
    ): StoreResult<Unit> {
        launches += request
        return launchResult
    }

    override suspend fun queryPurchases(): StoreResult<List<StorePurchase>> {
        purchaseQueries++
        return owned
    }

    fun unavailable() {
        offers = StoreResult.Failed(StoreFailure.UNAVAILABLE)
        owned = StoreResult.Failed(StoreFailure.UNAVAILABLE)
    }
}
