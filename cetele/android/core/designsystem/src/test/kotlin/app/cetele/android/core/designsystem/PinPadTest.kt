package app.cetele.android.core.designsystem

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import app.cetele.android.core.designsystem.component.PinPad
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class PinPadTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun sixDigitsCompleteOnceAndRemainMasked() {
        val results = mutableListOf<String>()
        compose.setContent { CeteleTheme { PinPad(onComplete = results::add) } }
        "12345".forEach { compose.onNodeWithContentDescription(it.toString()).performClick() }
        compose.runOnIdle { assertEquals(emptyList<String>(), results) }
        compose.onNodeWithContentDescription("6").performClick()
        compose.onNodeWithContentDescription("7").performClick()
        compose.runOnIdle { assertEquals(listOf("123456"), results) }
        compose.onNodeWithContentDescription("6 / 6 rakam girildi").assertIsDisplayed()
        compose.onNodeWithText("123456").assertDoesNotExist()
    }

    @Test
    fun resetStartsNewAttemptAndShowsError() {
        var attempt by mutableStateOf(0)
        var error by mutableStateOf<String?>(null)
        val results = mutableListOf<String>()
        compose.setContent { CeteleTheme { PinPad(results::add, error = error, resetKey = attempt) } }
        repeat(6) { compose.onNodeWithContentDescription("1").performClick() }
        compose.runOnIdle {
            attempt++
            error = "Kod hatalı"
        }
        compose.onNodeWithText("Kod hatalı").assertIsDisplayed()
        compose.onNodeWithContentDescription("0 / 6 rakam girildi").assertIsDisplayed()
        repeat(6) { compose.onNodeWithContentDescription("2").performClick() }
        compose.runOnIdle { assertEquals(listOf("111111", "222222"), results) }
    }
}
