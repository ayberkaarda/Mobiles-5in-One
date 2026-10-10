package app.cetele.android.feature.settings

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.MeApi
import app.cetele.android.core.network.dto.me.AccountDeletionBody
import app.cetele.android.core.network.dto.me.AccountDeletionReceipt
import app.cetele.android.feature.settings.account.AccountDeletionViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

class AccountDeletionViewModelTest : SettingsTestSupport() {
    private val auth = mockk<AuthApi>()
    private val me = mockk<MeApi>()
    private val shops = mockk<ShopRepository>()
    private val code = (1..6).joinToString("")
    private val receipt = AccountDeletionReceipt(Instant.EPOCH, Instant.EPOCH.plusSeconds(1209600), listOf("shop"))

    @Test
    fun successKeepsAccountActiveAndRefreshesGraceStatus() =
        runTest(dispatcher) {
            coEvery { auth.requestReauth() } returns ApiResult.Success(Unit, 202)
            coEvery { me.deleteAccount(AccountDeletionBody(code, false)) } returns ApiResult.Success(receipt, 202)
            coEvery { shops.refresh() } returns ApiResult.Success(Unit, 200)
            val model = AccountDeletionViewModel(auth, me, shops)
            model.requestCode().join()
            model.delete(code).join()
            assertEquals(receipt, model.state.value.receipt)
            assertFalse(model.state.value.codeSent)
            assertFalse(model.state.value.busy)
            coVerify(exactly = 1) { shops.refresh() }
        }

    @Test
    fun sharedOwnerCanChooseShopDeletionWithAFreshCode() =
        runTest(dispatcher) {
            coEvery { auth.requestReauth() } returns ApiResult.Success(Unit, 202)
            coEvery { me.deleteAccount(AccountDeletionBody(code, false)) } returns
                problem("account.owner_of_shared_shop")
            coEvery { me.deleteAccount(AccountDeletionBody(code, true)) } returns ApiResult.Success(receipt, 202)
            coEvery { shops.refresh() } returns ApiResult.Success(Unit, 200)
            val model = AccountDeletionViewModel(auth, me, shops)
            model.requestCode().join()
            model.delete(code).join()
            assertTrue(model.state.value.sharedShopChoice)
            model.dismissChoice()
            assertFalse(model.state.value.sharedShopChoice)
            model.requestCode().join()
            model.delete(code, true).join()
            assertEquals(receipt, model.state.value.receipt)
            coVerify(exactly = 1) { me.deleteAccount(AccountDeletionBody(code, true)) }
        }

    @Test
    fun invalidCodeAndPendingDeletionRemainVisibleWithoutRefresh() =
        runTest(dispatcher) {
            coEvery { auth.requestReauth() } returns ApiResult.Success(Unit, 202)
            val model = AccountDeletionViewModel(auth, me, shops)
            model.requestCode().join()
            for (reason in listOf("auth.reauth_invalid", "account.deletion_pending")) {
                coEvery { me.deleteAccount(any()) } returns problem(reason)
                model.delete(code).join()
                assertEquals(
                    reason,
                    model.state.value.error
                        ?.code,
                )
                assertEquals(null, model.state.value.receipt)
                assertTrue(model.state.value.codeSent)
            }
            coVerify(exactly = 0) { shops.refresh() }
        }

    @Test
    fun rateLimitNetworkFailureAndMalformedCodeDoNotSubmitDeletion() =
        runTest(dispatcher) {
            coEvery { auth.requestReauth() } returns problem("rate_limited", 40)
            val model = AccountDeletionViewModel(auth, me, shops)
            model.requestCode().join()
            assertEquals(
                40,
                model.state.value.error
                    ?.retryAfterSeconds,
            )
            model.delete(code).join()
            coVerify(exactly = 0) { me.deleteAccount(any()) }
            coEvery { auth.requestReauth() } returns ApiResult.Failure.Network(IllegalStateException())
            model.requestCode().join()
            assertFalse(model.state.value.codeSent)
            coEvery { auth.requestReauth() } returns ApiResult.Success(Unit, 202)
            model.requestCode().join()
            model.delete("12").join()
            assertEquals(
                "auth.reauth_invalid",
                model.state.value.error
                    ?.code,
            )
            coVerify(exactly = 0) { me.deleteAccount(any()) }
        }
}
