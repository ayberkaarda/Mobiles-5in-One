package app.cetele.android.feature.settings

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.dto.me.DeletionStatus
import app.cetele.android.feature.settings.account.AccountDeletionScreen
import app.cetele.android.feature.settings.account.AccountDeletionState
import app.cetele.android.feature.settings.home.SettingsHomeScreen
import app.cetele.android.feature.settings.home.SettingsHomeState
import app.cetele.android.feature.settings.shop.ShopDeletionScreen
import app.cetele.android.feature.settings.shop.ShopDeletionState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class SettingsHomeScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun staffSeesAccountDeletionButNoOwnerControls() {
        content(SettingsHomeState(shop = shop(ShopRole.STAFF)))
        compose.onNodeWithText("Hesabı sil").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Çıkış yap").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun ownerSeesBothOwnerControls() {
        content(SettingsHomeState(shop = shop()))
        compose.onNodeWithText("Dükkânı sil").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Sahipliği devret").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun blockedGraceBannerExplainsAndInvokesCancellation() {
        var cancelled = 0
        content(
            SettingsHomeState(deletion = DeletionStatus(Instant.EPOCH, Instant.parse("2026-10-20T10:00:00Z"), true)),
        ) {
            cancelled++
        }
        compose.onNodeWithText("Dükkâna yeni üye katıldığı için silme bekliyor").assertIsDisplayed()
        compose.onNodeWithText("Silmekten vazgeç").performClick()
        assertEquals(1, cancelled)
    }

    @Test
    fun planEntryOpensTheBillingScreenForEveryRole() {
        var opened = 0
        content(SettingsHomeState(shop = shop(ShopRole.STAFF)), billing = { opened++ })
        compose.onNodeWithText("Plan ve Çetele Pro").performScrollTo().performClick()
        assertEquals(1, opened)
    }

    @Test
    fun planEntryIsHiddenWithoutAShopOrWithoutTheCallback() {
        content(SettingsHomeState(), billing = {})
        compose.onNodeWithText("Plan ve Çetele Pro").assertDoesNotExist()
    }

    @Test
    fun shopDeletionTellsTheOwnerToCancelInPlayAndLinksThere() {
        var opened = 0
        compose.setContent {
            CeteleTheme {
                ShopDeletionScreen(ShopDeletionState(), {}, {}, {}, {}, onManageSubscription = { opened++ })
            }
        }
        compose
            .onNodeWithText("Silme işlemi Google Play'deki Çetele Pro aboneliğini iptal etmez.", substring = true)
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText("Aboneliği Google Play'de yönet").performScrollTo().performClick()
        assertEquals(1, opened)
    }

    @Test
    fun accountDeletionWithoutOwnedShopShowsNoSubscriptionNotice() {
        compose.setContent {
            CeteleTheme {
                AccountDeletionScreen(AccountDeletionState(), {}, { _, _ -> }, {}, {}, {}, onManageSubscription = null)
            }
        }
        compose.onNodeWithText("Aboneliği Google Play'de yönet").assertDoesNotExist()
    }

    private fun content(
        state: SettingsHomeState,
        billing: (() -> Unit)? = null,
        cancel: () -> Unit = {},
    ) {
        compose.setContent {
            CeteleTheme {
                SettingsHomeScreen(state, {}, cancel, {}, {}, {}, {}, billing)
            }
        }
    }
}
