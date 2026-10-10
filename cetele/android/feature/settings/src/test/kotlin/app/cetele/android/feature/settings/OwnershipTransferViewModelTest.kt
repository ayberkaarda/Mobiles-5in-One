package app.cetele.android.feature.settings

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.shops.MemberList
import app.cetele.android.core.network.dto.shops.MemberView
import app.cetele.android.core.network.dto.shops.OwnershipBody
import app.cetele.android.core.network.dto.shops.OwnershipReceipt
import app.cetele.android.feature.settings.shop.OwnershipTransferViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import java.time.Instant

class OwnershipTransferViewModelTest : SettingsTestSupport() {
    private val auth = mockk<AuthApi>()
    private val api = mockk<ShopsApi>()
    private val shops = mockk<ShopRepository>()
    private val active = MutableStateFlow(shop())
    private val code = (1..6).joinToString("")
    private val staff =
        MemberView(
            "staff",
            "+90" + "5321234567",
            "Ali",
            app.cetele.android.core.network.dto.ShopRole.STAFF,
            Instant.EPOCH,
        )

    private fun prepare(): OwnershipTransferViewModel {
        every { shops.observeActive() } returns active
        coEvery { api.members("shop") } returns
            ApiResult.Success(
                MemberList(
                    listOf(
                        staff,
                        staff.copy(userId = "owner", role = app.cetele.android.core.network.dto.ShopRole.OWNER),
                    ),
                ),
                200,
            )
        coEvery { auth.requestReauth() } returns ApiResult.Success(Unit, 202)
        return OwnershipTransferViewModel(auth, api, shops)
    }

    @Test
    fun pickerOnlyListsStaffAndSuccessRefreshesCallerRole() =
        runTest(dispatcher) {
            val model = prepare()
            val receipt = OwnershipReceipt("shop", "staff", "owner")
            coEvery { api.transferOwnership("shop", OwnershipBody("staff", code)) } returns
                ApiResult.Success(receipt, 200)
            coEvery { shops.refresh() } coAnswers {
                active.value = shop(ShopRole.STAFF)
                ApiResult.Success(Unit, 200)
            }
            model.load().join()
            assertEquals(listOf(staff), model.state.value.members)
            model.select("owner")
            assertEquals(null, model.state.value.selectedUserId)
            model.select("staff")
            model.requestCode().join()
            model.transfer(code).join()
            assertEquals(receipt, model.state.value.receipt)
            assertEquals(ShopRole.STAFF, active.value.role)
            assertFalse(model.state.value.codeSent)
            coVerify(exactly = 1) { shops.refresh() }
        }

    @Test
    fun invalidReauthRetainsSelectionAndDoesNotRefresh() =
        runTest(dispatcher) {
            val model = prepare()
            coEvery { api.transferOwnership(any(), any()) } returns problem("auth.reauth_invalid")
            model.load().join()
            model.select("staff")
            model.requestCode().join()
            model.transfer(code).join()
            assertEquals(
                "auth.reauth_invalid",
                model.state.value.error
                    ?.code,
            )
            assertEquals("staff", model.state.value.selectedUserId)
            coVerify(exactly = 0) { shops.refresh() }
        }

    @Test
    fun staffCannotLoadMembersOrTransferAfterRoleChanges() =
        runTest(dispatcher) {
            val model = prepare()
            model.load().join()
            model.select("staff")
            model.requestCode().join()
            active.value = shop(ShopRole.STAFF)
            model.transfer(code).join()
            assertEquals(
                "forbidden",
                model.state.value.error
                    ?.code,
            )
            coVerify(exactly = 0) { api.transferOwnership(any(), any()) }
            val other = prepare()
            other.load().join()
            assertEquals(emptyList<MemberView>(), other.state.value.members)
            coVerify(exactly = 1) { api.members(any()) }
        }
}
