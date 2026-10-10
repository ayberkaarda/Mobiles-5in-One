package app.cetele.android.feature.billing.gateway

import android.app.Activity
import android.content.Context
import app.cetele.android.feature.billing.BillingProduct
import app.cetele.android.feature.billing.ObfuscatedAccountId
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Google Play Billing behind [BillingGateway]. Purchases are passed on with their token for the server link and
 * are never acknowledged here; nothing about a purchase is logged.
 */
@Singleton
class PlayBillingGateway
    @Inject
    constructor(
        @ApplicationContext context: Context,
    ) : BillingGateway {
        private val updates =
            MutableSharedFlow<StoreResult<List<StorePurchase>>>(
                extraBufferCapacity = UPDATE_BUFFER,
                onBufferOverflow = BufferOverflow.DROP_OLDEST,
            )
        override val purchaseUpdates: Flow<StoreResult<List<StorePurchase>>> = updates.asSharedFlow()

        private val client: BillingClient =
            BillingClient
                .newBuilder(context)
                .setListener { result, purchases -> updates.tryEmit(purchaseUpdate(result, purchases)) }
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build()

        @Volatile private var details: ProductDetails? = null

        override suspend fun connect(): StoreResult<Unit> {
            if (client.isReady) return StoreResult.Ok(Unit)
            val result =
                suspendCancellableCoroutine { continuation ->
                    val done = AtomicBoolean(false)
                    client.startConnection(
                        object : BillingClientStateListener {
                            override fun onBillingSetupFinished(result: BillingResult) {
                                if (done.compareAndSet(false, true)) continuation.resume(result.responseCode)
                            }

                            override fun onBillingServiceDisconnected() {
                                if (done.compareAndSet(false, true)) {
                                    continuation.resume(BillingResponseCode.SERVICE_DISCONNECTED)
                                }
                            }
                        },
                    )
                }
            return if (result == BillingResponseCode.OK) StoreResult.Ok(Unit) else StoreResult.Failed(failureOf(result))
        }

        override suspend fun queryOffers(): StoreResult<List<ProOffer>> =
            when (val product = productDetails()) {
                is StoreResult.Failed -> product
                is StoreResult.Ok -> StoreResult.Ok(product.value.proOffers())
            }

        override suspend fun launchPurchase(
            activity: Activity,
            request: PurchaseRequest,
        ): StoreResult<Unit> {
            val product =
                when (val loaded = details?.let { StoreResult.Ok(it) } ?: productDetails()) {
                    is StoreResult.Failed -> return loaded
                    is StoreResult.Ok -> loaded.value
                }
            val productParams =
                BillingFlowParams.ProductDetailsParams
                    .newBuilder()
                    .setProductDetails(product)
                    .setOfferToken(request.offer.offerToken)
            val builder =
                BillingFlowParams
                    .newBuilder()
                    .setObfuscatedAccountId(ObfuscatedAccountId.of(request.shopId))
            // A base plan switch replaces the current purchase; the server links the new token and supersedes
            // the old row through linkedPurchaseToken (handoff 002, step 9).
            request.replacingToken?.let { oldToken ->
                productParams.setSubscriptionProductReplacementParams(
                    BillingFlowParams.ProductDetailsParams.SubscriptionProductReplacementParams
                        .newBuilder()
                        .setOldProductId(BillingProduct.PRODUCT_ID)
                        .setReplacementMode(REPLACEMENT_MODE)
                        .build(),
                )
                builder.setSubscriptionUpdateParams(
                    BillingFlowParams.SubscriptionUpdateParams
                        .newBuilder()
                        .setOldPurchaseToken(oldToken)
                        .build(),
                )
            }
            builder.setProductDetailsParamsList(listOf(productParams.build()))
            val result = client.launchBillingFlow(activity, builder.build())
            return if (result.responseCode == BillingResponseCode.OK) {
                StoreResult.Ok(Unit)
            } else {
                StoreResult.Failed(failureOf(result.responseCode))
            }
        }

        override suspend fun queryPurchases(): StoreResult<List<StorePurchase>> {
            val connected = connect()
            if (connected is StoreResult.Failed) return connected
            val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()
            val result = client.queryPurchasesAsync(params)
            return if (result.billingResult.responseCode == BillingResponseCode.OK) {
                StoreResult.Ok(result.purchasesList.map(Purchase::toStorePurchase))
            } else {
                StoreResult.Failed(failureOf(result.billingResult.responseCode))
            }
        }

        private suspend fun productDetails(): StoreResult<ProductDetails> {
            val connected = connect()
            if (connected is StoreResult.Failed) return connected
            val product =
                QueryProductDetailsParams.Product
                    .newBuilder()
                    .setProductId(BillingProduct.PRODUCT_ID)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            val result =
                client.queryProductDetails(
                    QueryProductDetailsParams.newBuilder().setProductList(listOf(product)).build(),
                )
            val found = result.productDetailsList?.firstOrNull { it.productId == BillingProduct.PRODUCT_ID }
            return when {
                result.billingResult.responseCode != BillingResponseCode.OK -> {
                    StoreResult.Failed(failureOf(result.billingResult.responseCode))
                }

                found == null -> {
                    StoreResult.Failed(StoreFailure.UNAVAILABLE)
                }

                else -> {
                    details = found
                    StoreResult.Ok(found)
                }
            }
        }

        private companion object {
            const val UPDATE_BUFFER = 8
            const val REPLACEMENT_MODE =
                BillingFlowParams.ProductDetailsParams.SubscriptionProductReplacementParams.ReplacementMode
                    .WITH_TIME_PRORATION
        }
    }

internal fun purchaseUpdate(
    result: BillingResult,
    purchases: List<Purchase>?,
): StoreResult<List<StorePurchase>> =
    if (result.responseCode == BillingResponseCode.OK) {
        StoreResult.Ok(purchases.orEmpty().map(Purchase::toStorePurchase))
    } else {
        StoreResult.Failed(failureOf(result.responseCode))
    }

internal fun failureOf(responseCode: Int): StoreFailure =
    when (responseCode) {
        BillingResponseCode.USER_CANCELED -> {
            StoreFailure.CANCELED
        }

        BillingResponseCode.ITEM_ALREADY_OWNED -> {
            StoreFailure.ALREADY_OWNED
        }

        BillingResponseCode.SERVICE_DISCONNECTED,
        BillingResponseCode.SERVICE_UNAVAILABLE,
        BillingResponseCode.BILLING_UNAVAILABLE,
        BillingResponseCode.FEATURE_NOT_SUPPORTED,
        BillingResponseCode.ITEM_UNAVAILABLE,
        BillingResponseCode.NETWORK_ERROR,
        -> {
            StoreFailure.UNAVAILABLE
        }

        else -> {
            StoreFailure.ERROR
        }
    }

internal fun Purchase.toStorePurchase(): StorePurchase =
    StorePurchase(
        purchaseToken = purchaseToken,
        products = products.toList(),
        state =
            when (purchaseState) {
                Purchase.PurchaseState.PURCHASED -> StorePurchaseState.PURCHASED
                Purchase.PurchaseState.PENDING -> StorePurchaseState.PENDING
                else -> StorePurchaseState.UNSPECIFIED
            },
        // Play reports an empty identifier for a purchase started without one; that purchase is unbound.
        obfuscatedAccountId = accountIdentifiers?.obfuscatedAccountId?.takeIf(String::isNotBlank),
    )

/** One offer per base plan: the base plan offer itself (no offer id), priced by its last pricing phase. */
internal fun ProductDetails.proOffers(): List<ProOffer> =
    subscriptionOfferDetails
        .orEmpty()
        .filter { it.offerId == null && it.basePlanId in setOf(BillingProduct.MONTHLY, BillingProduct.YEARLY) }
        .mapNotNull { offer ->
            offer.pricingPhases.pricingPhaseList.lastOrNull()?.let { phase ->
                ProOffer(offer.basePlanId, offer.offerToken, phase.formattedPrice, phase.billingPeriod)
            }
        }.sortedBy { if (it.basePlanId == BillingProduct.MONTHLY) 0 else 1 }
