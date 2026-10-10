package app.cetele.android.feature.shop

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.shops.MemberList
import app.cetele.android.core.network.dto.shops.MemberView
import app.cetele.android.feature.shop.members.MembersViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant
import app.cetele.android.core.network.dto.ShopRole as WireRole

@OptIn(ExperimentalCoroutinesApi::class)
class MembersViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val shops = mockk<ShopRepository>()
    private val api = mockk<ShopsApi>()
    private val active =
        MutableStateFlow<Shop?>(
            Shop(
                "shop-one",
                "Market",
                ShopType.BAKKAL,
                "İstanbul",
                "Kadıköy",
                ShopPlan.FREE,
                ShopRole.OWNER,
                Instant.EPOCH,
            ),
        )
    private val member = MemberView("member-one", "+905321234567", "Deniz", WireRole.STAFF, Instant.EPOCH)

    @BeforeEach fun prepare() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns active
    }

    @AfterEach fun finish() {
        Dispatchers.resetMain()
    }

    @Test fun staffCannotFetchMembersOrRemoveThem() =
        runTest(dispatcher) {
            active.value = requireNotNull(active.value).copy(role = ShopRole.STAFF)
            val model = MembersViewModel(shops, api)
            advanceUntilIdle()
            model.refresh()
            model.requestRemoval(member)
            model.remove()
            advanceUntilIdle()
            assertEquals(emptyList<MemberView>(), model.state.value.members)
            assertNull(model.state.value.removal)
            coVerify(exactly = 0) { api.members(any()) }
            coVerify(exactly = 0) { api.removeMember(any(), any()) }
        }

    @Test fun confirmationRemovesOnlyTheSelectedMember() =
        runTest(dispatcher) {
            coEvery { api.members("shop-one") } returns ApiResult.Success(MemberList(listOf(member)), 200)
            coEvery { api.removeMember("shop-one", "member-one") } returns ApiResult.Success(Unit, 204)
            val model = MembersViewModel(shops, api)
            advanceUntilIdle()
            model.requestRemoval(member)
            coVerify(exactly = 0) { api.removeMember(any(), any()) }
            model.remove()
            advanceUntilIdle()
            assertEquals(emptyList<MemberView>(), model.state.value.members)
            assertNull(model.state.value.removal)
            coVerify(exactly = 1) { api.removeMember("shop-one", "member-one") }
        }

    @Test fun ownerLockedLeavesTheListIntactAndRetainsItsCode() =
        runTest(dispatcher) {
            coEvery { api.members(any()) } returns ApiResult.Success(MemberList(listOf(member)), 200)
            coEvery { api.removeMember(any(), any()) } returns
                ApiResult.Failure.Problem(
                    ProblemDetail(title = "Conflict", status = 409, code = "membership.owner_locked"),
                )
            val model = MembersViewModel(shops, api)
            advanceUntilIdle()
            model.requestRemoval(member)
            model.remove()
            advanceUntilIdle()
            assertEquals(listOf(member), model.state.value.members)
            assertEquals(
                "membership.owner_locked",
                model.state.value.failure
                    ?.code,
            )
            assertNull(model.state.value.removal)
        }
}
