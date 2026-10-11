package app.cetele.android.feature.settings

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.ReauthAction
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.shops.DeletionReceipt
import app.cetele.android.core.network.dto.shops.ReauthCode
import app.cetele.android.feature.settings.shop.ShopDeletionViewModel
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

class ShopDeletionViewModelTest : SettingsTestSupport() {
    private val auth = mockk<AuthApi>()
    private val api = mockk<ShopsApi>()
    private val shops = mockk<ShopRepository>()
    private val active = MutableStateFlow(shop())

    private fun model(): ShopDeletionViewModel {
        every { shops.observeActive() } returns active
        return ShopDeletionViewModel(auth, api, shops)
    }

    @Test fun requestBindsCodeToOwnedShopAndDeletesOnlyThatShop() =
        runTest(dispatcher) {
            val model = model()
            val receipt = DeletionReceipt(Instant.EPOCH, Instant.EPOCH.plusSeconds(1209600))
            coEvery { auth.requestReauth(ReauthAction.SHOP_DELETE, "shop") } returns ApiResult.Success(Unit, 202)
            coEvery { api.deleteShop("shop", ReauthCode("123456")) } returns ApiResult.Success(receipt, 202)
            model.requestCode().join()
            active.value = shop().copy(id = "another")
            model.delete("123456").join()
            coVerify(exactly = 0) { api.deleteShop(any(), any()) }
            active.value = shop()
            model.delete("123456").join()
            assertEquals(receipt, model.state.value.receipt)
            assertFalse(model.state.value.codeSent)
            coVerify(exactly = 1) { auth.requestReauth(ReauthAction.SHOP_DELETE, "shop") }
        }

    @Test fun staffAndRejectedRequestCannotSubmitDeletion() =
        runTest(dispatcher) {
            val model = model()
            active.value = shop(ShopRole.STAFF)
            model.requestCode().join()
            coVerify(exactly = 0) { auth.requestReauth(any(), any()) }
            active.value = shop()
            coEvery { auth.requestReauth(ReauthAction.SHOP_DELETE, "shop") } returns problem("not_found")
            model.requestCode().join()
            assertFalse(model.state.value.codeSent)
            assertEquals(
                "not_found",
                model.state.value.error
                    ?.code,
            )
            model.delete("123456").join()
            coVerify(exactly = 0) { api.deleteShop(any(), any()) }
        }
}
