package app.cetele.android.feature.ledger

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.feature.ledger.dashboard.DashboardScreen
import app.cetele.android.feature.ledger.dashboard.DashboardState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class DashboardScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val syncing =
        SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Eşitleniyor")

    @Test
    fun runningSyncIsAnnouncedAndClearsWhenItEnds() {
        var refreshing by mutableStateOf(false)
        compose.setContent {
            CeteleTheme {
                DashboardScreen(DashboardState(loading = false), {}, {}, {}, refreshing = refreshing)
            }
        }
        compose.onNodeWithText("Paneli görmek için bir dükkân seçin").assertExists()
        compose.onAllNodes(syncing).assertCountEquals(0)

        compose.runOnIdle { refreshing = true }
        compose.onAllNodes(syncing).assertCountEquals(1)

        compose.runOnIdle { refreshing = false }
        compose.onAllNodes(syncing).assertCountEquals(0)
    }
}
