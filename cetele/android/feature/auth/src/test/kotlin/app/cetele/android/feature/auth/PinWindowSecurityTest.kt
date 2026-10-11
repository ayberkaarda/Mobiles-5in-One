package app.cetele.android.feature.auth

import android.app.Application
import android.view.Window
import android.view.WindowManager
import androidx.activity.compose.LocalActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.feature.auth.lock.LockScreen
import app.cetele.android.feature.auth.lock.LockScreenState
import app.cetele.android.feature.auth.pinsetup.PinSetupScreen
import app.cetele.android.feature.auth.pinsetup.PinSetupState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class PinWindowSecurityTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun lockScreenIsSecureOnlyWhileVisible() {
        assertSecureOnlyWhileShown { LockScreen(LockScreenState(), {}, {}, {}, {}, {}) }
    }

    @Test
    fun pinSetupScreenIsSecureOnlyWhileVisible() {
        assertSecureOnlyWhileShown { PinSetupScreen(PinSetupState(), { _, _ -> }, {}) }
    }

    private fun assertSecureOnlyWhileShown(pinScreen: @Composable () -> Unit) {
        var showPin by mutableStateOf(false)
        var window: Window? = null
        compose.setContent {
            window = LocalActivity.current?.window
            CeteleTheme { if (showPin) pinScreen() else Text("ledger") }
        }
        compose.runOnIdle { assertFalse(window!!.isSecure()) }
        compose.runOnIdle { showPin = true }
        compose.runOnIdle { assertTrue(window!!.isSecure()) }
        compose.runOnIdle { showPin = false }
        compose.runOnIdle { assertFalse(window!!.isSecure()) }
    }

    private fun Window.isSecure(): Boolean = attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
}
