package app.cetele.android.shop

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
import app.cetele.android.feature.export.navigation.ExportRoutes
import app.cetele.android.feature.shop.navigation.ShopRoutes
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class ShopHomeScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun shop(role: ShopRole) =
        Shop("shop-1", "Yılmaz Bakkal", ShopType.BAKKAL, "İstanbul", "Kadıköy", ShopPlan.FREE, role, Instant.EPOCH)

    @Test
    fun ownerOpensMembersAndFullExport() {
        val opened = mutableListOf<Any>()
        compose.setContent { CeteleTheme { ShopHomeScreen(shop(ShopRole.OWNER), { opened += it }) } }

        compose.onNodeWithText("Yılmaz Bakkal").assertIsDisplayed()
        compose.onNodeWithText("Çalışanlar").performClick()
        compose.onNodeWithText("Tüm kayıtları dışa aktar").performClick()

        assertEquals(listOf<Any>(ShopRoutes.Members, ExportRoutes.All), opened)
    }

    @Test
    fun staffSeesNoOwnerActions() {
        val opened = mutableListOf<Any>()
        compose.setContent { CeteleTheme { ShopHomeScreen(shop(ShopRole.STAFF), { opened += it }) } }

        compose.onNodeWithText("Çalışanlar").assertDoesNotExist()
        compose.onNodeWithText("Tüm kayıtları dışa aktar").assertDoesNotExist()
        compose.onNodeWithText("Dükkân değiştir veya ekle").performClick()

        assertEquals(listOf<Any>(ShopRoutes.Switcher), opened)
    }
}
