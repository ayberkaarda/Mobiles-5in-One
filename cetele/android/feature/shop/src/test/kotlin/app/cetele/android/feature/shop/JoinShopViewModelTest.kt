package app.cetele.android.feature.shop

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.feature.shop.join.JoinShopViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class JoinShopViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val shops = mockk<ShopRepository>(relaxed = true)

    @BeforeEach fun prepare() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterEach fun finish() {
        Dispatchers.resetMain()
    }

    @Test fun onlyEightAsciiLettersOrDigitsReachRepository() {
        val model = JoinShopViewModel(shops)
        for (code in listOf("", "abcd123", "abcd12345", "abcd!234", "çbcd1234")) {
            model.change(code)
            model.submit()
            assertTrue(model.state.value.invalidCode)
        }
        coVerify(exactly = 0) { shops.join(any()) }
    }

    @Test fun successActivatesJoinedShopAndKeepsCodeCase() =
        runTest(dispatcher) {
            val shop =
                Shop(
                    "shop-two",
                    "Market",
                    ShopType.BAKKAL,
                    "İstanbul",
                    "Kadıköy",
                    ShopPlan.FREE,
                    ShopRole.STAFF,
                    Instant.EPOCH,
                )
            coEvery { shops.join("aBcD1234") } returns ApiResult.Success(shop, 200)
            val model = JoinShopViewModel(shops)
            model.change(" aBcD1234 ")
            model.submit()
            model.submit()
            advanceUntilIdle()
            assertEquals("shop-two", model.state.value.completedShopId)
            coVerify(exactly = 1) { shops.join("aBcD1234") }
            coVerify(exactly = 1) { shops.setActive("shop-two") }
        }

    @Test fun notFoundGetsInvitationCopyAndEditingClearsIt() =
        runTest(dispatcher) {
            coEvery { shops.join(any()) } returns
                ApiResult.Failure.Problem(ProblemDetail(title = "Missing", status = 404, code = "not_found"))
            val model = JoinShopViewModel(shops)
            model.change("abcd1234")
            model.submit()
            advanceUntilIdle()
            assertTrue(requireNotNull(model.state.value.failure).invalidInvitation)
            assertFalse(model.state.value.busy)
            coVerify(exactly = 0) { shops.setActive(any()) }
            model.change("abcd5678")
            assertEquals(null, model.state.value.failure)
        }

    @Test fun retryAfterIsRetainedAndNetworkFailureAllowsManualRetry() =
        runTest(dispatcher) {
            coEvery { shops.join(any()) } returnsMany
                listOf(
                    ApiResult.Failure.Problem(ProblemDetail(title = "Wait", status = 429, code = "rate_limited"), 42),
                    ApiResult.Failure.Network(IllegalStateException("Offline")),
                )
            val model = JoinShopViewModel(shops)
            model.change("abcd1234")
            model.submit()
            advanceUntilIdle()
            assertEquals(
                42,
                model.state.value.failure
                    ?.retryAfterSeconds,
            )
            model.submit()
            advanceUntilIdle()
            assertFalse(model.state.value.busy)
            assertEquals(null, model.state.value.completedShopId)
            coVerify(exactly = 2) { shops.join("abcd1234") }
        }
}
