package app.cetele.android.feature.settings

import android.app.Application
import android.view.Window
import android.view.WindowManager
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.feature.settings.devices.DevicesScreen
import app.cetele.android.feature.settings.devices.DevicesState
import app.cetele.android.feature.settings.home.SettingsHomeScreen
import app.cetele.android.feature.settings.home.SettingsHomeState
import app.cetele.android.feature.settings.lock.LockSettingsScreen
import app.cetele.android.feature.settings.lock.LockSettingsState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class SettingsWindowSecurityTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun onlyThePinChangeScreenProtectsTheWindow() {
        var screen by mutableStateOf("home")
        var window: Window? = null
        compose.setContent {
            window = LocalActivity.current?.window
            CeteleTheme {
                when (screen) {
                    "home" -> SettingsHomeScreen(SettingsHomeState(), {}, {}, {}, {}, {}, {}, null)
                    "devices" -> DevicesScreen(DevicesState(), {}, {}, {}, {}, {}, {})
                    else -> LockSettingsScreen(LockSettingsState(), false, { _, _, _, _, _, _ -> }, {})
                }
            }
        }
        compose.runOnIdle { assertFalse(window!!.isSecure()) }
        compose.runOnIdle { screen = "devices" }
        compose.runOnIdle { assertFalse(window!!.isSecure()) }
        compose.runOnIdle { screen = "lock" }
        compose.runOnIdle { assertTrue(window!!.isSecure()) }
        compose.runOnIdle { screen = "home" }
        compose.runOnIdle { assertFalse(window!!.isSecure()) }
    }

    private fun Window.isSecure(): Boolean = attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
}
