package app.cetele.android.feature.settings

import app.cetele.android.core.data.lock.PinStore
import app.cetele.android.core.data.lock.PinVerdict
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.feature.settings.lock.LockSettingsError
import app.cetele.android.feature.settings.lock.LockSettingsViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LockSettingsViewModelTest : SettingsTestSupport() {
    private val pins = mockk<PinStore>()
    private val repository = mockk<SettingsRepository>()
    private val settings = MutableStateFlow(UserSettings())
    private val old = (1..6).joinToString("")
    private val fresh = (6 downTo 1).joinToString("")

    private fun model(): LockSettingsViewModel {
        every { repository.settings } returns settings
        coEvery { repository.update(any()) } coAnswers {
            val transform = firstArg<(UserSettings) -> UserSettings>()
            transform(settings.value).also { settings.value = it }
        }
        return LockSettingsViewModel(pins, repository)
    }

    @Test
    fun wrongPinAndDelayCannotChangeAnyLockSetting() =
        runTest(dispatcher) {
            val model = model()
            every { pins.verify(any()) } returns PinVerdict.Wrong(4)
            model.save(old, fresh, fresh, true, 60, true).join()
            assertEquals(LockSettingsError.WRONG_PIN, model.state.value.error)
            every { pins.verify(any()) } returns PinVerdict.Delayed(30000)
            model.save(old, fresh, fresh, true, 60, true).join()
            assertEquals(LockSettingsError.DELAYED, model.state.value.error)
            assertEquals(30000L, model.state.value.delayedUntilMillis)
            assertFalse(model.state.value.saved)
            coVerify(exactly = 0) { repository.update(any()) }
            verify(exactly = 0) { pins.set(any()) }
        }

    @Test
    fun verifiedPinChangesHashAndPersistsBiometricAndEachTimeout() =
        runTest(dispatcher) {
            val model = model()
            var hashInput = ""
            every { pins.verify(any()) } answers {
                assertEquals(old, firstArg<CharArray>().concatToString())
                PinVerdict.Ok
            }
            every { pins.set(any()) } answers { hashInput = firstArg<CharArray>().concatToString() }
            model.save(old, fresh, fresh, true, 60, true).join()
            assertEquals(fresh, hashInput)
            assertTrue(settings.value.biometricUnlockEnabled)
            assertEquals(60, settings.value.lockTimeoutSeconds)
            assertTrue(model.state.value.saved)
            for (timeout in listOf(120, 300)) {
                model.save(old, "", "", false, timeout, false).join()
                assertEquals(timeout, settings.value.lockTimeoutSeconds)
                assertFalse(settings.value.biometricUnlockEnabled)
            }
            verify(exactly = 1) { pins.set(any()) }
        }

    @Test
    fun malformedMismatchAndUnavailableBiometricDoNotVerifyPin() =
        runTest(dispatcher) {
            val model = model()
            model.save(old, "123", "123", false, 120, true).join()
            assertEquals(LockSettingsError.INVALID_PIN, model.state.value.error)
            model.save(old, fresh, old, false, 120, true).join()
            assertEquals(LockSettingsError.MISMATCH, model.state.value.error)
            model.save(old, "", "", true, 120, false).join()
            assertEquals(LockSettingsError.BIOMETRIC_UNAVAILABLE, model.state.value.error)
            verify(exactly = 0) { pins.verify(any()) }
        }
}
