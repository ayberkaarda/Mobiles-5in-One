package app.cetele.android.core.designsystem

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.cetele.android.core.designsystem.component.ConfirmSheet
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class ConfirmSheetTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun confirmationRequiresExplicitClick() {
        var confirmations = 0
        var dismissals = 0
        compose.setContent {
            CeteleTheme {
                ConfirmSheet(
                    "Düzeltme",
                    "Bu kayıt geri alınacak",
                    "Düzelt",
                    true,
                    { confirmations++ },
                    { dismissals++ },
                )
            }
        }
        compose.onNodeWithText("Bu kayıt geri alınacak").assertIsDisplayed()
        compose.runOnIdle { assertEquals(0, confirmations) }
        compose.onNodeWithText("Düzelt").performClick()
        compose.runOnIdle {
            assertEquals(1, confirmations)
            assertEquals(0, dismissals)
        }
    }

    @Test
    fun cancelOnlyDismissesTheSheet() {
        var confirmations = 0
        var dismissals = 0
        compose.setContent {
            CeteleTheme {
                ConfirmSheet(
                    "Düzeltme",
                    "Bu kayıt geri alınacak",
                    "Düzelt",
                    false,
                    { confirmations++ },
                    { dismissals++ },
                )
            }
        }
        compose.onNodeWithText("Vazgeç").performClick()
        compose.runOnIdle {
            assertEquals(0, confirmations)
            assertEquals(1, dismissals)
        }
    }

    @Test
    fun loadingDisablesConfirmationAndCancel() {
        compose.setContent {
            CeteleTheme {
                ConfirmSheet("Düzeltme", "Bu kayıt geri alınacak", "Düzelt", true, {}, {}, loading = true)
            }
        }
        compose.onNodeWithText("İşlem sürüyor").assertIsNotEnabled()
        compose.onNodeWithText("Vazgeç").assertIsNotEnabled()
    }
}
