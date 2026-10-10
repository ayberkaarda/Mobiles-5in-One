package app.cetele.android.feature.auth.pinsetup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.lock.PinStore
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.domain.validation.Limits
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import javax.inject.Inject

data class PinSetupState(
    val repeating: Boolean = false,
    val mismatch: Boolean = false,
    val biometricEnabled: Boolean = false,
    val loading: Boolean = false,
    val complete: Boolean = false,
    val attempt: Int = 0,
)

@HiltViewModel
class PinSetupViewModel
    @Inject
    constructor(
        private val pins: PinStore,
        private val settings: SettingsRepository,
        private val lock: LockController,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(PinSetupState())
        val state = mutableState.asStateFlow()
        private var firstPin: CharArray? = null

        fun enableBiometric(enabled: Boolean) {
            mutableState.update { it.copy(biometricEnabled = enabled) }
        }

        fun enter(
            pin: String,
            biometricAvailable: Boolean,
        ) {
            val busy = state.value.loading || state.value.complete
            if (busy || !isWellFormed(pin)) return
            val entered = pin.toCharArray()
            val first = firstPin
            if (first == null) {
                firstPin = entered
                mutableState.update { it.copy(repeating = true, mismatch = false, attempt = it.attempt + 1) }
            } else {
                val left = ByteArray(first.size) { first[it].code.toByte() }
                val right = ByteArray(entered.size) { entered[it].code.toByte() }
                val matches = MessageDigest.isEqual(left, right)
                left.fill(0)
                right.fill(0)
                first.fill('\u0000')
                firstPin = null
                if (!matches) {
                    entered.fill('\u0000')
                    mutableState.update { it.copy(repeating = false, mismatch = true, attempt = it.attempt + 1) }
                } else {
                    mutableState.update { it.copy(loading = true) }
                    viewModelScope.launch {
                        try {
                            withContext(Dispatchers.Default) { pins.set(entered) }
                            settings.update {
                                it.copy(
                                    pinSetupDone = true,
                                    biometricUnlockEnabled =
                                        biometricAvailable && state.value.biometricEnabled,
                                )
                            }
                            lock.unlock()
                            mutableState.update { it.copy(loading = false, complete = true) }
                        } finally {
                            entered.fill('\u0000')
                        }
                    }
                }
            }
        }

        private fun isWellFormed(pin: String): Boolean = pin.length == Limits.PIN_LENGTH && pin.all { it in '0'..'9' }

        override fun onCleared() {
            firstPin?.fill('\u0000')
            firstPin = null
        }
    }
