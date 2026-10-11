package app.cetele.android.feature.billing.gateway

import android.app.Activity
import app.cetele.android.feature.billing.BillingProduct
import app.cetele.android.feature.billing.ObfuscatedAccountId
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Debug-only store for the emulator without a Play account (ADR-0004 G1). A "purchase" produces the token
 * `fake.sub.<state>.<shopId>` that the server's fake Play adapter understands (ADR-0031) and reports it exactly
 * like Play does, so the app links it through the real server call. Not part of release builds.
 */
class FakeBillingGateway(
    private val state: String = "active",
) : BillingGateway {
    private val updates =
        MutableSharedFlow<StoreResult<List<StorePurchase>>>(
            extraBufferCapacity = UPDATE_BUFFER,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )
    override val purchaseUpdates: Flow<StoreResult<List<StorePurchase>>> = updates.asSharedFlow()

    private val owned = mutableListOf<StorePurchase>()

    override suspend fun connect(): StoreResult<Unit> = StoreResult.Ok(Unit)

    override suspend fun queryOffers(): StoreResult<List<ProOffer>> =
        StoreResult.Ok(
            listOf(
                ProOffer(BillingProduct.MONTHLY, "fake-offer-monthly", "₺49,99", "P1M"),
                ProOffer(BillingProduct.YEARLY, "fake-offer-yearly", "₺499,99", "P1Y"),
            ),
        )

    override suspend fun launchPurchase(
        activity: Activity,
        request: PurchaseRequest,
    ): StoreResult<Unit> {
        val shopId = request.shopId
        val suffix = if (request.replacingToken == null) "" else "." + request.offer.basePlanId
        val purchase =
            StorePurchase(
                purchaseToken = "fake.sub.$state.$shopId$suffix",
                products = listOf(BillingProduct.PRODUCT_ID),
                state = StorePurchaseState.PURCHASED,
                obfuscatedAccountId = ObfuscatedAccountId.of(shopId),
            )
        synchronized(owned) {
            owned.removeAll { it.obfuscatedAccountId == purchase.obfuscatedAccountId }
            owned += purchase
        }
        updates.tryEmit(StoreResult.Ok(listOf(purchase)))
        return StoreResult.Ok(Unit)
    }

    override suspend fun queryPurchases(): StoreResult<List<StorePurchase>> =
        StoreResult.Ok(synchronized(owned) { owned.toList() })

    private companion object {
        const val UPDATE_BUFFER = 8
    }
}
