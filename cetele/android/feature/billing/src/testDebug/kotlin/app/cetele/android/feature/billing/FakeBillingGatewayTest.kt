package app.cetele.android.feature.billing

import android.app.Activity
import app.cetele.android.feature.billing.gateway.FakeBillingGateway
import app.cetele.android.feature.billing.gateway.ProOffer
import app.cetele.android.feature.billing.gateway.PurchaseRequest
import app.cetele.android.feature.billing.gateway.StorePurchase
import app.cetele.android.feature.billing.gateway.StorePurchaseState
import app.cetele.android.feature.billing.gateway.StoreResult
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FakeBillingGatewayTest {
    private val shopId = "01928c3e-5f6a-7b8c-9d0e-1f2a3b4c5d6e"
    private val monthly = ProOffer("monthly", "fake-offer-monthly", "₺49,99", "P1M")

    @Test
    fun `fake purchase reports the server fake token grammar with the shop obfuscated id`() =
        runTest {
            val gateway = FakeBillingGateway()
            val update = async(UnconfinedTestDispatcher(testScheduler)) { gateway.purchaseUpdates.first() }
            gateway.launchPurchase(mockk<Activity>(), PurchaseRequest(shopId, monthly))
            val expected =
                StorePurchase(
                    "fake.sub.active.$shopId",
                    listOf("cetele_pro"),
                    StorePurchaseState.PURCHASED,
                    "775ddbc0c97c6683bb78cafdffea51471b53ceb7fbd89993ed36e130430db621",
                )
            assertEquals(StoreResult.Ok(listOf(expected)), update.await())
            assertEquals(StoreResult.Ok(listOf(expected)), gateway.queryPurchases())
        }

    @Test
    fun `configured state and plan switch produce distinct tokens`() =
        runTest {
            val gateway = FakeBillingGateway("pending")
            gateway.launchPurchase(mockk<Activity>(), PurchaseRequest(shopId, monthly))
            gateway.launchPurchase(mockk<Activity>(), PurchaseRequest(shopId, monthly, "fake.sub.pending.$shopId"))
            val owned = (gateway.queryPurchases() as StoreResult.Ok).value
            assertEquals(listOf("fake.sub.pending.$shopId.monthly"), owned.map { it.purchaseToken })
        }

    @Test
    fun `fake offers list both base plans`() =
        runTest {
            val offers = (FakeBillingGateway().queryOffers() as StoreResult.Ok).value
            assertEquals(listOf("monthly", "yearly"), offers.map { it.basePlanId })
        }
}
