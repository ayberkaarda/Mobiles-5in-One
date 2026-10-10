package app.cetele.android.core.designsystem

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import app.cetele.android.core.designsystem.component.AmountKeypad
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class AmountKeypadTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun digitsAndCommaProduceMinorUnitsAndRejectThirdDecimal() {
        var result = 0L
        var calls = 0
        compose.setContent {
            var value by remember { mutableStateOf(0L) }
            CeteleTheme {
                AmountKeypad(value, onChange = {
                    value = it
                    result = it
                    calls++
                })
            }
        }
        enter("1250,5")
        compose.runOnIdle { assertEquals(125050L, result) }
        enter("0")
        compose.runOnIdle {
            assertEquals(125050L, result)
            assertEquals(7, calls)
        }
        enter("1")
        compose.runOnIdle {
            assertEquals(125050L, result)
            assertEquals(7, calls)
        }
        compose.onNodeWithContentDescription("Son rakamı sil").performClick()
        enter("1")
        compose.runOnIdle { assertEquals(125051L, result) }
    }

    @Test
    fun disabledKeypadCannotChangeValue() {
        var result = 0L
        compose.setContent { CeteleTheme { AmountKeypad(0L, { result = it }, enabled = false) } }
        compose.onNodeWithContentDescription("1").assertIsNotEnabled()
        compose.runOnIdle { assertEquals(0L, result) }
    }

    private fun enter(text: String) {
        text.forEach {
            compose.onNodeWithContentDescription(if (it == ',') "Ondalık ayırıcı" else it.toString()).performClick()
        }
    }
}
