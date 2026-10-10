package app.cetele.android.feature.shop

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.shops.CreateInvitationRequest
import app.cetele.android.core.network.dto.shops.IssuedInvitation
import app.cetele.android.feature.shop.invite.InviteViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
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
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class InviteViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val shops = mockk<ShopRepository>()
    private val api = mockk<ShopsApi>()
    private val active = MutableStateFlow<Shop?>(shop(ShopRole.OWNER))

    @BeforeEach fun prepare() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns active
    }

    @AfterEach fun finish() {
        Dispatchers.resetMain()
    }

    @Test fun invalidPhoneDoesNotSendInvitation() =
        runTest(dispatcher) {
            val model = InviteViewModel(shops, api)
            runCurrent()
            model.change("123")
            model.submit()
            assertTrue(model.state.value.invalidPhone)
            coVerify(exactly = 0) { api.invite(any(), any()) }
        }

    @Test fun normalizesPhoneAndIssuesOnlyOneCodeForTheScreen() =
        runTest(dispatcher) {
            val issued =
                IssuedInvitation("invitation-one", "+905321234567", "abcd1234", Instant.EPOCH.plusSeconds(86400))
            coEvery { api.invite("shop-one", CreateInvitationRequest("+905321234567")) } returns
                ApiResult.Success(issued, 201)
            val model = InviteViewModel(shops, api)
            runCurrent()
            model.change("0532 123 45 67")
            model.submit()
            model.submit()
            advanceUntilIdle()
            assertEquals(issued, model.state.value.invitation)
            model.submit()
            coVerify(exactly = 1) { api.invite(any(), any()) }
            active.value = shop(ShopRole.STAFF)
            runCurrent()
            assertNull(model.state.value.invitation)
            assertEquals(ShopRole.STAFF, model.state.value.role)
        }

    @Test fun staffCannotIssueEvenWithValidInput() =
        runTest(dispatcher) {
            active.value = shop(ShopRole.STAFF)
            val model = InviteViewModel(shops, api)
            runCurrent()
            model.change("05321234567")
            model.submit()
            advanceUntilIdle()
            coVerify(exactly = 0) { api.invite(any(), any()) }
        }

    @Test fun alreadyMemberAndRetryDelayAreRetainedForCopy() =
        runTest(dispatcher) {
            coEvery { api.invite(any(), any()) } returnsMany
                listOf(
                    ApiResult.Failure.Problem(
                        ProblemDetail(title = "Conflict", status = 409, code = "membership.already_member"),
                    ),
                    ApiResult.Failure.Problem(ProblemDetail(title = "Wait", status = 429, code = "rate_limited"), 30),
                )
            val model = InviteViewModel(shops, api)
            runCurrent()
            model.change("05321234567")
            model.submit()
            advanceUntilIdle()
            assertEquals(
                "membership.already_member",
                model.state.value.failure
                    ?.code,
            )
            assertFalse(model.state.value.busy)
            model.submit()
            advanceUntilIdle()
            assertEquals(
                30,
                model.state.value.failure
                    ?.retryAfterSeconds,
            )
            assertNull(model.state.value.invitation)
        }

    @Test fun leavingClearsIssuedCodeAndDiscardsAnInFlightResult() =
        runTest(dispatcher) {
            val response = CompletableDeferred<ApiResult<IssuedInvitation>>()
            coEvery { api.invite(any(), any()) } coAnswers { response.await() }
            val model = InviteViewModel(shops, api)
            runCurrent()
            model.change("05321234567")
            model.submit()
            runCurrent()
            model.leaveScreen()
            response.complete(
                ApiResult.Success(IssuedInvitation("invitation-one", "+905321234567", "abcd1234", Instant.EPOCH), 201),
            )
            advanceUntilIdle()
            assertNull(model.state.value.invitation)
            assertEquals("", model.state.value.phone)
            assertFalse(model.state.value.busy)
        }

    private fun shop(role: ShopRole) =
        Shop("shop-one", "Market", ShopType.BAKKAL, "İstanbul", "Kadıköy", ShopPlan.FREE, role, Instant.EPOCH)
}
