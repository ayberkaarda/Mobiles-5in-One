package app.cetele.android.feature.auth.lock

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.lock.PinStore
import app.cetele.android.core.data.lock.PinVerdict
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.session.SignOutCheck
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.vault.Vault
import app.cetele.android.core.data.vault.VaultKeys
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Clock
import javax.inject.Inject

data class LockScreenState(
    val biometricEnabled: Boolean = false,
    val wrongPin: Boolean = false,
    val delaySeconds: Int = 0,
    val loading: Boolean = false,
    val unlocked: Boolean = false,
    val confirmSignOut: Boolean = false,
    val pendingCount: Int = 0,
    val confirmPending: Boolean = false,
    val signedOut: Boolean = false,
    val attempt: Int = 0,
    val biometricError: Boolean = false,
)

@HiltViewModel
class LockViewModel
    @Inject
    constructor(
        private val pins: PinStore,
        private val lock: LockController,
        private val session: SessionManager,
        settings: SettingsRepository,
        private val clock: Clock,
        vault: Vault,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(LockScreenState())
        val state = mutableState.asStateFlow()

        init {
            viewModelScope.launch {
                settings.settings.collect { current ->
                    mutableState.update { it.copy(biometricEnabled = current.biometricUnlockEnabled) }
                }
            }
            val until = vault.get(VaultKeys.PIN_DELAY_UNTIL)?.toString(Charsets.UTF_8)?.toLongOrNull() ?: 0L
            if (until > clock.millis()) viewModelScope.launch { countdown(until) }
        }

        fun enter(pin: String) {
            if (state.value.loading || state.value.delaySeconds > 0 || state.value.unlocked) return
            mutableState.update { it.copy(loading = true, wrongPin = false) }
            val chars = pin.toCharArray()
            viewModelScope.launch {
                val verdict =
                    try {
                        withContext(Dispatchers.Default) { pins.verify(chars) }
                    } finally {
                        chars.fill('\u0000')
                    }
                mutableState.update { it.copy(loading = false, attempt = it.attempt + 1) }
                when (verdict) {
                    PinVerdict.Ok -> unlock()
                    is PinVerdict.Wrong -> mutableState.update { it.copy(wrongPin = true) }
                    is PinVerdict.Delayed -> countdown(verdict.untilMillis)
                }
            }
        }

        private suspend fun countdown(untilMillis: Long) {
            do {
                val remaining = ((untilMillis - clock.millis()).coerceAtLeast(0) + SECOND_MILLIS - 1) / SECOND_MILLIS
                mutableState.update { it.copy(delaySeconds = remaining.toInt(), wrongPin = true) }
                if (remaining > 0) delay(SECOND_MILLIS)
            } while (state.value.delaySeconds > 0)
        }

        fun biometricSucceeded() {
            if (state.value.biometricEnabled) unlock()
        }

        fun biometricUnavailable() {
            mutableState.update { it.copy(biometricError = true) }
        }

        private fun unlock() {
            lock.unlock()
            mutableState.update { it.copy(unlocked = true, wrongPin = false, delaySeconds = 0, biometricError = false) }
        }

        fun forgotPin() {
            mutableState.update { it.copy(confirmSignOut = true) }
        }

        fun dismissSignOut() {
            if (!state.value.loading) mutableState.update { it.copy(confirmSignOut = false, confirmPending = false) }
        }

        fun confirmSignOut() {
            if (!state.value.confirmSignOut || state.value.loading) return
            mutableState.update { it.copy(loading = true) }
            viewModelScope.launch {
                val check = session.checkSignOut()
                if (check is SignOutCheck.Pending && !state.value.confirmPending) {
                    mutableState.update { it.copy(loading = false, pendingCount = check.count, confirmPending = true) }
                } else {
                    session.signOut(SignOutReason.USER)
                    mutableState.update { it.copy(loading = false, confirmSignOut = false, signedOut = true) }
                }
            }
        }

        private companion object {
            const val SECOND_MILLIS = 1000L
        }
    }
