package app.cetele.android.core.designsystem

import android.app.Application
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.cetele.android.core.designsystem.component.CustomerRow
import app.cetele.android.core.domain.model.Money
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class CustomerRowTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun rowExposesNameFormattedBalanceAndClick() {
        var clicks = 0
        compose.setContent {
            CeteleTheme {
                CustomerRow("Örnek müşteri", Money(125000), { clicks++ }, tag = "Örnek etiket")
            }
        }
        compose.onNodeWithText("Örnek müşteri").assertIsDisplayed().assertHeightIsAtLeast(CeteleSpacing.rowMinHeight)
        compose.onNodeWithText("₺1.250,00").assertIsDisplayed()
        compose.onNodeWithText("Örnek etiket").assertIsDisplayed()
        compose.onNodeWithText("Örnek müşteri").performClick()
        compose.runOnIdle { assertEquals(1, clicks) }
    }

    @Test
    fun paymentBalanceRetainsItsSign() {
        compose.setContent { CeteleTheme { CustomerRow("Örnek müşteri", Money(-1200), {}) } }
        compose.onNodeWithText("-₺12,00").assertIsDisplayed()
    }
}
