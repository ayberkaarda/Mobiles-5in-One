package app.cetele.android.feature.auth

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.feature.auth.lock.LockScreen
import app.cetele.android.feature.auth.lock.LockScreenState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class LockScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun wrongPinShowsCopyAndStartsAFreshMaskedAttempt() {
        var state by mutableStateOf(LockScreenState())
        val attempts = mutableListOf<String>()
        compose.setContent {
            CeteleTheme {
                LockScreen(state, {
                    attempts += it
                    state = state.copy(wrongPin = true, attempt = state.attempt + 1)
                }, {}, {}, {}, {})
            }
        }
        "123456".forEach { compose.onNodeWithContentDescription(it.toString()).performClick() }
        compose.onNodeWithText("PIN hatalı, tekrar deneyin").assertIsDisplayed()
        compose.onNodeWithContentDescription("0 / 6 rakam girildi").assertIsDisplayed()
        compose.onNodeWithText("123456").assertDoesNotExist()
        compose.runOnIdle { assertEquals(listOf("123456"), attempts) }
    }

    @Test
    fun delayShowsCountdownAndDisablesThePinPad() {
        var state by mutableStateOf(LockScreenState(wrongPin = true, delaySeconds = 30))
        compose.setContent { CeteleTheme { LockScreen(state, {}, {}, {}, {}, {}) } }
        compose.onNodeWithText("30 sn sonra tekrar deneyin").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("1").assertIsNotEnabled()
        compose.runOnIdle { state = state.copy(delaySeconds = 29) }
        compose.onNodeWithText("29 sn sonra tekrar deneyin").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun biometricButtonIsHiddenWhenDisabledAndCallsTheActionWhenEnabled() {
        var state by mutableStateOf(LockScreenState())
        var calls = 0
        compose.setContent { CeteleTheme { LockScreen(state, {}, { calls++ }, {}, {}, {}) } }
        compose.onNodeWithText("Biyometrik kilidi aç").assertDoesNotExist()
        compose.runOnIdle { state = state.copy(biometricEnabled = true) }
        compose.onNodeWithText("Biyometrik kilidi aç").performClick()
        compose.runOnIdle { assertEquals(1, calls) }
    }

    @Test
    fun forgotPinRequiresASecondConfirmationForUnsentRecords() {
        var state by mutableStateOf(LockScreenState())
        var confirmations = 0
        compose.setContent {
            CeteleTheme {
                LockScreen(state, {}, {}, { state = state.copy(confirmSignOut = true) }, {
                    confirmations++
                    state = state.copy(confirmPending = true, pendingCount = 3)
                }, { state = state.copy(confirmSignOut = false) })
            }
        }
        compose.onNodeWithText("PIN'imi unuttum").performClick()
        compose.onNodeWithText("Çıkış yap").performClick()
        compose
            .onNodeWithText(
                "Gönderilmemiş 3 kayıt var. Çıkış yaparsanız bu kayıtlar silinir. Yine de çıkış yapılsın mı?",
            ).assertIsDisplayed()
        compose.runOnIdle { assertEquals(1, confirmations) }
        compose.onNodeWithText("Çıkış yap").performClick()
        compose.runOnIdle { assertEquals(2, confirmations) }
    }
}
