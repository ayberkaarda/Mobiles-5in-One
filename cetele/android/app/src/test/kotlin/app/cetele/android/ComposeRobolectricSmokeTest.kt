package app.cetele.android

import android.app.Application
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class ComposeRobolectricSmokeTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun clickUpdatesComposeState() {
        compose.setContent {
            var confirmed by remember { mutableStateOf(false) }
            Button(onClick = { confirmed = true }) {
                Text(if (confirmed) "Kaydedildi" else "Kaydet")
            }
        }
        compose.onNodeWithText("Kaydet").performClick()
        compose.onNodeWithText("Kaydedildi").assertIsDisplayed()
    }
}
