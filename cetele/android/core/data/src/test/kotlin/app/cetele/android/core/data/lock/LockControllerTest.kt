package app.cetele.android.core.data.lock

import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class LockControllerTest {
    private val pins = mockk<PinStore>()
    private val settings = mockk<SettingsRepository>()
    private val elapsed = MutableElapsedClock(1000)

    @Test fun elapsedTimeoutLocksWithoutReadingOrWritingWallTimestamps() =
        runTest {
            every { pins.isSet() } returns true
            coEvery { settings.current() } returns
                UserSettings(lockTimeoutSeconds = 120, backgroundedAtEpochMillis = Long.MAX_VALUE)
            val controller = LockController(pins, settings, elapsed)
            controller.onAppStart()
            assertEquals(LockState.Locked, controller.state.value)
            controller.unlock()
            controller.onAppStop()
            elapsed.now = 120999
            controller.onAppStart()
            assertEquals(LockState.Unlocked, controller.state.value)
            elapsed.now = 121000
            controller.onAppStart()
            assertEquals(LockState.Locked, controller.state.value)
            coVerify(exactly = 0) { settings.update(any()) }
        }

    @Test fun rollbackLocksAndNewProcessStartsLocked() =
        runTest {
            every { pins.isSet() } returns true
            coEvery { settings.current() } returns UserSettings()
            val controller = LockController(pins, settings, elapsed)
            controller.onAppStart()
            controller.unlock()
            controller.onAppStop()
            elapsed.now--
            controller.onAppStart()
            assertEquals(LockState.Locked, controller.state.value)
            val restarted = LockController(pins, settings, elapsed)
            restarted.onAppStart()
            assertEquals(LockState.Locked, restarted.state.value)
        }

    @Test fun noPinDoesNotLock() =
        runTest {
            every { pins.isSet() } returns false
            coEvery { settings.current() } returns UserSettings()
            val controller = LockController(pins, settings, elapsed)
            controller.onAppStart()
            controller.onAppStop()
            elapsed.now += 300000
            controller.onAppStart()
            assertEquals(LockState.NoPin, controller.state.value)
        }
}
