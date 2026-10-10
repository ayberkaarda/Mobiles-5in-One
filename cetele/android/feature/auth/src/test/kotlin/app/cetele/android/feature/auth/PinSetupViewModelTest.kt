package app.cetele.android.feature.auth

import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.lock.PinStore
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.feature.auth.pinsetup.PinSetupViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PinSetupViewModelTest : MainDispatcherTest() {
    private val pins = mockk<PinStore>()
    private val lock = mockk<LockController>(relaxed = true)
    private val settings = mockk<SettingsRepository>()

    @Test
    fun mismatchedOrMalformedPinsDoNotWriteTheVaultOrSettings() =
        runTest(dispatcher) {
            val model = PinSetupViewModel(pins, settings, lock)
            model.enter("12", false)
            assertFalse(model.state.value.repeating)
            model.enter("123456", false)
            assertTrue(model.state.value.repeating)
            model.enter("654321", false)
            assertTrue(model.state.value.mismatch)
            assertFalse(model.state.value.repeating)
            assertFalse(model.state.value.complete)
            verify(exactly = 0) { pins.set(any()) }
            coVerify(exactly = 0) { settings.update(any()) }
            verify(exactly = 0) { lock.unlock() }
        }

    @Test
    fun matchingPinIsStoredAndClearedFromTheTemporaryArrayBeforeUnlock() =
        runTest(dispatcher) {
            var received: CharArray? = null
            every { pins.set(any()) } answers {
                val chars = firstArg<CharArray>()
                received = chars
                assertEquals("123456", chars.concatToString())
            }
            var stored = UserSettings()
            coEvery { settings.update(any()) } answers
                { firstArg<(UserSettings) -> UserSettings>().invoke(stored).also { stored = it } }
            val model = PinSetupViewModel(pins, settings, lock)
            model.enableBiometric(true)
            model.enter("123456", true)
            model.enter("123456", true)
            model.state.first { it.complete }
            assertTrue(stored.pinSetupDone)
            assertTrue(stored.biometricUnlockEnabled)
            assertTrue(checkNotNull(received).all { it == '\u0000' })
            verify(exactly = 1) { pins.set(any()) }
            verify(exactly = 1) { lock.unlock() }
        }

    @Test
    fun biometricPreferenceCannotBeEnabledOnAnUnsupportedDevice() =
        runTest(dispatcher) {
            every { pins.set(any()) } returns Unit
            var stored = UserSettings()
            coEvery { settings.update(any()) } answers
                { firstArg<(UserSettings) -> UserSettings>().invoke(stored).also { stored = it } }
            val model = PinSetupViewModel(pins, settings, lock)
            model.enableBiometric(true)
            model.enter("123456", false)
            model.enter("123456", false)
            model.state.first { it.complete }
            assertTrue(stored.pinSetupDone)
            assertFalse(stored.biometricUnlockEnabled)
        }
}
