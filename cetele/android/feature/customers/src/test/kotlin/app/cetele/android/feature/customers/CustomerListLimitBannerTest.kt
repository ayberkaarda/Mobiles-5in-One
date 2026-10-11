package app.cetele.android.feature.customers

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import app.cetele.android.feature.customers.list.CustomerListScreen
import app.cetele.android.feature.customers.list.CustomerListState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class CustomerListLimitBannerTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun ownerOnTheFreePlanOpensTheProScreenFromTheLimitBanner() {
        var opened = 0
        show(shop(ShopRole.OWNER, ShopPlan.FREE)) { opened++ }

        compose.onNodeWithText("Müşteri sınırına ulaştınız").assertIsDisplayed()
        compose.onNodeWithText("Çetele Pro'ya geç").performClick()

        assertEquals(1, opened)
    }

    @Test
    fun staffIsToldThatTheOwnerCanUpgrade() {
        show(shop(ShopRole.STAFF, ShopPlan.FREE)) {}

        compose.onNodeWithText("Dükkân sahibi Çetele Pro'ya geçebilir").assertIsDisplayed()
        compose.onNodeWithText("Çetele Pro'ya geç").assertDoesNotExist()
    }

    @Test
    fun proShopShowsNoBanner() {
        show(shop(ShopRole.OWNER, ShopPlan.PRO)) {}

        compose.onNodeWithText("Müşteri sınırına ulaştınız").assertDoesNotExist()
        compose.onNodeWithText("Çetele Pro'ya geç").assertDoesNotExist()
    }

    private fun show(
        shop: Shop,
        onUpgrade: () -> Unit,
    ) {
        compose.setContent {
            CeteleTheme {
                CustomerListScreen(
                    CustomerListState(shop = shop, loading = false),
                    {},
                    {},
                    {},
                    customerLimitRejected = true,
                    onUpgrade = onUpgrade,
                )
            }
        }
    }

    private fun shop(
        role: ShopRole,
        plan: ShopPlan,
    ) = Shop("shop-a", "Dükkân", ShopType.BAKKAL, "İstanbul", "Kadıköy", plan, role, Instant.EPOCH)
}
