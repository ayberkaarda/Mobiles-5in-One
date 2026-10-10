package app.cetele.android.feature.billing

import android.app.Application
import app.cetele.android.feature.billing.gateway.StoreFailure
import app.cetele.android.feature.billing.gateway.StorePurchaseState
import app.cetele.android.feature.billing.gateway.StoreResult
import app.cetele.android.feature.billing.gateway.failureOf
import app.cetele.android.feature.billing.gateway.purchaseUpdate
import app.cetele.android.feature.billing.gateway.toStorePurchase
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.Purchase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Purchase JSON shapes follow the Play Billing documentation; not verified against a live Play account. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class PlayPurchaseMappingTest {
    private val token = "fake.sub.active.$SHOP_ID"

    @Test
    fun purchasedSubscriptionKeepsTokenProductAndObfuscatedAccountId() {
        val purchase = Purchase(json(state = 0, withAccount = true), "signature").toStorePurchase()
        assertEquals(token, purchase.purchaseToken)
        assertEquals(listOf("cetele_pro"), purchase.products)
        assertEquals(StorePurchaseState.PURCHASED, purchase.state)
        assertEquals(SHOP_HASH, purchase.obfuscatedAccountId)
        assertFalse(purchase.toString().contains(token))
        assertFalse(purchase.toString().contains(SHOP_HASH))
    }

    @Test
    fun pendingPurchaseWithoutAccountIdentifiersIsPendingAndUnbound() {
        val purchase = Purchase(json(state = 4, withAccount = false), "signature").toStorePurchase()
        assertEquals(StorePurchaseState.PENDING, purchase.state)
        assertNull(purchase.obfuscatedAccountId)
    }

    @Test
    fun purchaseUpdatesCarryPurchasesOrTheFailure() {
        val ok = purchaseUpdate(result(BillingResponseCode.OK), listOf(Purchase(json(0, true), "signature")))
        assertEquals(StorePurchaseState.PURCHASED, (ok as StoreResult.Ok).value.single().state)
        assertEquals(StoreResult.Ok(emptyList<Any>()), purchaseUpdate(result(BillingResponseCode.OK), null))
        assertEquals(
            StoreResult.Failed(StoreFailure.CANCELED),
            purchaseUpdate(result(BillingResponseCode.USER_CANCELED), null),
        )
    }

    @Test
    fun responseCodesMapToStoreFailures() {
        assertEquals(StoreFailure.CANCELED, failureOf(BillingResponseCode.USER_CANCELED))
        assertEquals(StoreFailure.ALREADY_OWNED, failureOf(BillingResponseCode.ITEM_ALREADY_OWNED))
        listOf(
            BillingResponseCode.SERVICE_DISCONNECTED,
            BillingResponseCode.SERVICE_UNAVAILABLE,
            BillingResponseCode.BILLING_UNAVAILABLE,
            BillingResponseCode.FEATURE_NOT_SUPPORTED,
            BillingResponseCode.ITEM_UNAVAILABLE,
            BillingResponseCode.NETWORK_ERROR,
        ).forEach { assertEquals(StoreFailure.UNAVAILABLE, failureOf(it)) }
        assertEquals(StoreFailure.ERROR, failureOf(BillingResponseCode.DEVELOPER_ERROR))
        assertEquals(StoreFailure.ERROR, failureOf(BillingResponseCode.ERROR))
    }

    private fun result(code: Int): BillingResult = BillingResult.newBuilder().setResponseCode(code).build()

    private fun json(
        state: Int,
        withAccount: Boolean,
    ): String {
        val account = if (withAccount) ""","obfuscatedAccountId":"$SHOP_HASH"""" else ""
        return """{"orderId":"GPA.0000-0000-0000-00000","packageName":"app.cetele.android",""" +
            """"productIds":["cetele_pro"],"purchaseTime":1760175005000,"purchaseState":$state,""" +
            """"purchaseToken":"$token","quantity":1,"autoRenewing":true,"acknowledged":false$account}"""
    }
}
