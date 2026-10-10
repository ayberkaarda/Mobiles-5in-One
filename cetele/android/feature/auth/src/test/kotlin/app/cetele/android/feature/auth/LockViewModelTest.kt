package app.cetele.android.feature.auth

import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.lock.PinStore
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.session.SignOutCheck
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.data.vault.Vault
import app.cetele.android.core.data.vault.VaultKeys
import app.cetele.android.feature.auth.lock.LockViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class LockViewModelTest : MainDispatcherTest() {
    private val pins = mockk<PinStore>()
    private val lock = mockk<LockController>(relaxed = true)
    private val session = mockk<SessionManager>(relaxed = true)
    private val settings = mockk<SettingsRepository>()
    private val vault = mockk<Vault>()

    private val virtualClock =
        object : Clock() {
            override fun getZone(): ZoneId = ZoneOffset.UTC

            override fun withZone(zone: ZoneId): Clock = this

            override fun instant(): Instant = Instant.ofEpochMilli(dispatcher.scheduler.currentTime)
        }

    private fun model(
        biometricEnabled: Boolean = false,
        delayMillis: Long = 0,
    ): LockViewModel {
        every { settings.settings } returns flowOf(UserSettings(biometricUnlockEnabled = biometricEnabled))
        every { vault.get(VaultKeys.PIN_DELAY_UNTIL) } returns delayMillis.toString().toByteArray(Charsets.UTF_8)
        return LockViewModel(pins, lock, session, settings, virtualClock, vault)
    }

    @Test
    fun restoredDelayIsShownBeforeAnyPinAttemptAndBlocksVerification() =
        runTest(dispatcher) {
            val model = model(delayMillis = 30_000)
            runCurrent()
            assertEquals(30, model.state.value.delaySeconds)
            model.enter("123456")
            verify(exactly = 0) { pins.verify(any()) }
            verify(exactly = 0) { lock.unlock() }
            advanceTimeBy(29_000)
            runCurrent()
            assertEquals(1, model.state.value.delaySeconds)
            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(0, model.state.value.delaySeconds)
        }

    @Test
    fun biometricSuccessOnlyUnlocksWhenThePreferenceIsEnabled() =
        runTest(dispatcher) {
            val disabled = model()
            runCurrent()
            disabled.biometricSucceeded()
            assertFalse(disabled.state.value.unlocked)
            verify(exactly = 0) { lock.unlock() }
            val enabled = model(biometricEnabled = true)
            runCurrent()
            enabled.biometricSucceeded()
            assertTrue(enabled.state.value.unlocked)
            verify(exactly = 1) { lock.unlock() }
        }

    @Test
    fun forgotPinDoesNotDiscardPendingRowsUntilTheSecondConfirmation() =
        runTest(dispatcher) {
            coEvery { session.checkSignOut() } returns SignOutCheck.Pending(4)
            val model = model()
            model.forgotPin()
            model.confirmSignOut()
            runCurrent()
            assertEquals(4, model.state.value.pendingCount)
            assertTrue(model.state.value.confirmPending)
            assertFalse(model.state.value.signedOut)
            coVerify(exactly = 0) { session.signOut(any()) }
            model.confirmSignOut()
            runCurrent()
            assertTrue(model.state.value.signedOut)
            coVerify(exactly = 1) { session.signOut(SignOutReason.USER) }
        }

    @Test
    fun dismissingTheConfirmationDoesNotSignOut() =
        runTest(dispatcher) {
            val model = model()
            model.forgotPin()
            model.dismissSignOut()
            model.confirmSignOut()
            runCurrent()
            assertFalse(model.state.value.confirmSignOut)
            coVerify(exactly = 0) { session.checkSignOut() }
            coVerify(exactly = 0) { session.signOut(any()) }
        }
}
