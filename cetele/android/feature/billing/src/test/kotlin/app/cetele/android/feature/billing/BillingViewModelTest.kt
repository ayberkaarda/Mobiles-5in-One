package app.cetele.android.feature.billing

import android.app.Activity
import androidx.lifecycle.viewModelScope
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.BillingApi
import app.cetele.android.core.network.dto.billing.LinkPurchaseRequest
import app.cetele.android.core.network.dto.billing.SubscriptionState
import app.cetele.android.feature.billing.gateway.PurchaseRequest
import app.cetele.android.feature.billing.gateway.StoreFailure
import app.cetele.android.feature.billing.gateway.StorePurchaseState
import app.cetele.android.feature.billing.gateway.StoreResult
import app.cetele.android.feature.billing.link.BillingLinkClient
import app.cetele.android.feature.billing.link.BillingLinkScheduler
import app.cetele.android.feature.billing.link.PurchaseLinker
import app.cetele.android.feature.billing.ui.BillingNotice
import app.cetele.android.feature.billing.ui.BillingViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class BillingViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val api = mockk<BillingApi>()
    private val shops = mockk<ShopRepository>()
    private val work = mockk<WorkManager>(relaxed = true)
    private val gateway = TestGateway()
    private val active = MutableStateFlow<Shop?>(null)
    private val memberships = MutableStateFlow<List<Shop>>(emptyList())
    private val activity = mockk<Activity>()

    @BeforeEach
    fun installMain() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns active
        every { shops.observeShops() } returns memberships
        coEvery { shops.refresh() } returns ApiResult.Success(Unit, 200)
    }

    @AfterEach
    fun restoreMain() {
        Dispatchers.resetMain()
    }

    @Test
    fun ownerWithoutSubscriptionSeesBothOffersAndNoManageButton() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            val model = open(shop())
            val state = model.state.value
            assertTrue(state.isOwner)
            assertTrue(state.showOffers)
            assertFalse(state.showManage)
            assertEquals(listOf(monthly, yearly), state.offers)
            assertEquals(100, state.overview?.customers?.limit)
            assertEquals(1, gateway.purchaseQueries)
            assertFalse(state.busy)
            close(model)
        }

    @Test
    fun ownerWithEntitledSubscriptionManagesItInsteadOfBuying() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(proState(), 200)
            val model = open(shop())
            assertFalse(model.state.value.showOffers)
            assertTrue(model.state.value.showManage)
            assertTrue(
                model.state.value.overview
                    ?.customers
                    ?.unlimited == true,
            )
            close(model)
        }

    @Test
    fun ownerWithExpiredSubscriptionSeesTheOffersAgain() =
        runTest(dispatcher) {
            val expired = proState(subscription(SubscriptionState.EXPIRED, entitled = false))
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(expired, 200)
            val model = open(shop())
            assertTrue(model.state.value.showOffers)
            assertFalse(model.state.value.showManage)
            close(model)
        }

    @Test
    fun staffSeesPlanLimitsAndUsageOnlyAndCannotPurchase() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            val model = open(shop(ShopRole.STAFF))
            val state = model.state.value
            assertFalse(state.isOwner)
            assertFalse(state.showOffers)
            assertFalse(state.showManage)
            assertEquals(42, state.overview?.customers?.used)
            assertEquals(0, gateway.offerQueries)
            assertEquals(0, gateway.purchaseQueries)
            model.subscribe(activity, monthly).join()
            model.restore().join()
            assertTrue(gateway.launches.isEmpty())
            assertEquals(0, gateway.purchaseQueries)
            close(model)
        }

    @Test
    fun purchaseUsesTheShopAndLinksOnlyAfterPendingBecomesPurchased() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            coEvery { api.link(SHOP_ID, any()) } returns ApiResult.Success(proState(), 200)
            memberships.value = listOf(shop())
            val model = open(shop())
            model.subscribe(activity, yearly).join()
            assertEquals(listOf(PurchaseRequest(SHOP_ID, yearly, null)), gateway.launches)
            assertTrue(model.state.value.purchasing)

            gateway.purchaseUpdates.emit(StoreResult.Ok(listOf(purchase(state = StorePurchaseState.PENDING))))
            runCurrent()
            assertTrue(model.state.value.pendingPayment)
            assertFalse(model.state.value.purchasing)
            coVerify(exactly = 0) { api.link(any(), any()) }

            gateway.purchaseUpdates.emit(StoreResult.Ok(listOf(purchase())))
            runCurrent()
            coVerify(exactly = 1) { api.link(SHOP_ID, LinkPurchaseRequest("cetele_pro", "fake.sub.active.$SHOP_ID")) }
            coVerify(exactly = 1) { shops.refresh() }
            assertFalse(model.state.value.pendingPayment)
            assertEquals(BillingNotice.Linked, model.state.value.notice)
            assertTrue(model.state.value.showManage)
            assertTrue(model.state.value.canSwitchPlan)
            close(model)
        }

    @Test
    fun purchaseMadeForAShopTheUserDoesNotOwnIsNotLinked() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            memberships.value = listOf(shop(), shop(ShopRole.STAFF, OTHER_SHOP_ID))
            val model = open(shop())
            gateway.purchaseUpdates.emit(StoreResult.Ok(listOf(purchase(OTHER_SHOP_ID))))
            val foreign = purchase().copy(obfuscatedAccountId = null)
            gateway.purchaseUpdates.emit(StoreResult.Ok(listOf(foreign)))
            runCurrent()
            coVerify(exactly = 0) { api.link(any(), any()) }
            close(model)
        }

    @Test
    fun restoreOnOpenLinksPurchasesOfOwnedShopsOnly() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            coEvery { api.link(SHOP_ID, any()) } returns ApiResult.Success(proState(), 200)
            memberships.value = listOf(shop(), shop(ShopRole.STAFF, OTHER_SHOP_ID))
            gateway.owned = StoreResult.Ok(listOf(purchase(), purchase(OTHER_SHOP_ID)))
            val model = open(shop())
            coVerify(exactly = 1) { api.link(SHOP_ID, any()) }
            coVerify(exactly = 0) { api.link(OTHER_SHOP_ID, any()) }
            assertTrue(model.state.value.showManage)
            assertEquals(BillingNotice.Linked, model.state.value.notice)

            model.restore().join()
            // A token linked in this session is not sent again, which keeps the link rate limit free.
            coVerify(exactly = 1) { api.link(SHOP_ID, any()) }
            close(model)
        }

    @Test
    fun restoreShowsAPendingPurchaseWithoutLinking() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            memberships.value = listOf(shop())
            gateway.owned = StoreResult.Ok(listOf(purchase(state = StorePurchaseState.PENDING)))
            val model = open(shop())
            assertTrue(model.state.value.pendingPayment)
            coVerify(exactly = 0) { api.link(any(), any()) }
            close(model)
        }

    @Test
    fun manualRestoreWithNothingToLinkSaysSo() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            memberships.value = listOf(shop())
            val model = open(shop())
            assertNull(model.state.value.notice)
            model.restore().join()
            assertEquals(BillingNotice.NothingToRestore, model.state.value.notice)
            model.dismissNotice()
            assertNull(model.state.value.notice)
            close(model)
        }

    @Test
    fun unavailableVerificationQueuesTheLinkInBackgroundWork() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            coEvery { api.link(SHOP_ID, any()) } returns problem(503, BillingProblemCodes.UNAVAILABLE, 30)
            memberships.value = listOf(shop())
            val model = open(shop())
            gateway.purchaseUpdates.emit(StoreResult.Ok(listOf(purchase())))
            runCurrent()
            assertEquals(BillingNotice.Queued, model.state.value.notice)
            verify(exactly = 1) {
                work.enqueueUniqueWork(
                    "billing-link-a8bacd564eb7c299",
                    ExistingWorkPolicy.KEEP,
                    any<OneTimeWorkRequest>(),
                )
            }
            close(model)
        }

    @Test
    fun finalRefusalsShowTheirCodeAndAlreadySubscribedRefreshesTheState() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            memberships.value = listOf(shop())
            val model = open(shop())
            for (code in listOf(BillingProblemCodes.TOKEN_IN_USE, BillingProblemCodes.PURCHASE_INVALID)) {
                val status = if (code == BillingProblemCodes.TOKEN_IN_USE) 409 else 422
                coEvery { api.link(SHOP_ID, any()) } returns problem(status, code)
                gateway.purchaseUpdates.emit(StoreResult.Ok(listOf(purchase())))
                runCurrent()
                assertEquals(BillingNotice.Problem(code), model.state.value.notice)
            }
            coEvery { api.link(SHOP_ID, any()) } returns problem(409, BillingProblemCodes.ALREADY_SUBSCRIBED)
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(proState(), 200)
            gateway.purchaseUpdates.emit(StoreResult.Ok(listOf(purchase())))
            runCurrent()
            assertEquals(BillingNotice.Problem(BillingProblemCodes.ALREADY_SUBSCRIBED), model.state.value.notice)
            assertTrue(model.state.value.showManage)
            verify(exactly = 0) { work.enqueueUniqueWork(any<String>(), any(), any<OneTimeWorkRequest>()) }
            close(model)
        }

    @Test
    fun cancelledSheetIsSilentAndStoreErrorsAreShown() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            val model = open(shop())
            model.subscribe(activity, monthly).join()
            gateway.purchaseUpdates.emit(StoreResult.Failed(StoreFailure.CANCELED))
            runCurrent()
            assertFalse(model.state.value.purchasing)
            assertNull(model.state.value.notice)
            gateway.launchResult = StoreResult.Failed(StoreFailure.ERROR)
            model.subscribe(activity, monthly).join()
            assertEquals(BillingNotice.StoreError, model.state.value.notice)
            assertFalse(model.state.value.purchasing)
            close(model)
        }

    @Test
    fun missingPlayShowsTheOffersAsUnavailable() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            gateway.unavailable()
            val model = open(shop())
            assertTrue(model.state.value.storeUnavailable)
            assertTrue(
                model.state.value.offers
                    .isEmpty(),
            )
            assertTrue(model.state.value.showOffers)
            close(model)
        }

    @Test
    fun loadFailureKeepsTheCodeAndRetryAfter() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns problem(429, "rate_limited", 20)
            val model = open(shop(ShopRole.STAFF))
            assertEquals(BillingNotice.Problem("rate_limited", 20), model.state.value.loadError)
            assertNull(model.state.value.overview)
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(freeState(), 200)
            model.refresh().join()
            assertNull(model.state.value.loadError)
            assertEquals(
                42,
                model.state.value.overview
                    ?.customers
                    ?.used,
            )
            close(model)
        }

    @Test
    fun planSwitchReplacesTheCurrentStorePurchase() =
        runTest(dispatcher) {
            coEvery { api.state(SHOP_ID) } returns ApiResult.Success(proState(), 200)
            coEvery { api.link(SHOP_ID, any()) } returns ApiResult.Success(proState(), 200)
            memberships.value = listOf(shop())
            gateway.owned = StoreResult.Ok(listOf(purchase()))
            val model = open(shop())
            assertTrue(model.state.value.canSwitchPlan)
            model.dismissNotice()
            model.subscribe(activity, yearly).join()
            assertEquals(PurchaseRequest(SHOP_ID, yearly, "fake.sub.active.$SHOP_ID"), gateway.launches.single())
            close(model)
        }

    private fun TestScope.open(shop: Shop): BillingViewModel {
        val linker = PurchaseLinker(BillingLinkClient(api, shops), BillingLinkScheduler(work), gateway, shops)
        val model = BillingViewModel(shops, api, gateway, linker)
        active.value = shop
        runCurrent()
        return model
    }

    private fun close(model: BillingViewModel) {
        model.viewModelScope.cancel()
    }
}
