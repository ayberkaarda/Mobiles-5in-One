package app.cetele.android.feature.settings.lock

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.lock.PinStore
import app.cetele.android.core.data.lock.PinVerdict
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.domain.validation.Limits
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

enum class LockSettingsError { WRONG_PIN, DELAYED, INVALID_PIN, MISMATCH, BIOMETRIC_UNAVAILABLE }

data class LockSettingsState(
    val settings: UserSettings = UserSettings(),
    val busy: Boolean = false,
    val error: LockSettingsError? = null,
    val delayedUntilMillis: Long? = null,
    val saved: Boolean = false,
)

@HiltViewModel
class LockSettingsViewModel
    @Inject
    constructor(
        private val pins: PinStore,
        private val repository: SettingsRepository,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(LockSettingsState())
        val state = mutableState.asStateFlow()

        init {
            viewModelScope.launch {
                repository.settings.collect {
                    mutableState.value =
                        state.value.copy(
                            settings = it,
                        )
                }
            }
        }

        @Suppress("LongParameterList")
        fun save(
            oldPin: String,
            newPin: String,
            repeatPin: String,
            biometric: Boolean,
            timeout: Int,
            available: Boolean,
        ) = viewModelScope.launch {
            if (state.value.busy) return@launch
            mutableState.value = state.value.copy(error = null, saved = false, delayedUntilMillis = null)
            val error = validate(newPin, repeatPin, biometric, available)
            if (error != null) {
                mutableState.value = state.value.copy(error = error)
                return@launch
            }
            require(timeout in TIMEOUTS)
            mutableState.value = state.value.copy(busy = true)
            val oldChars = oldPin.toCharArray()
            val newChars = newPin.toCharArray()
            try {
                val verdict = withContext(Dispatchers.Default) { pins.verify(oldChars) }
                when (verdict) {
                    PinVerdict.Ok -> {
                        if (newChars.isNotEmpty()) withContext(Dispatchers.Default) { pins.set(newChars) }
                        repository.update { it.copy(biometricUnlockEnabled = biometric, lockTimeoutSeconds = timeout) }
                        mutableState.value = state.value.copy(saved = true)
                    }

                    is PinVerdict.Wrong -> {
                        mutableState.value = state.value.copy(error = LockSettingsError.WRONG_PIN)
                    }

                    is PinVerdict.Delayed -> {
                        mutableState.value =
                            state.value.copy(
                                error = LockSettingsError.DELAYED,
                                delayedUntilMillis = verdict.untilMillis,
                            )
                    }
                }
            } finally {
                oldChars.fill('\u0000')
                newChars.fill('\u0000')
                mutableState.value = state.value.copy(busy = false)
            }
        }

        private fun validate(
            pin: String,
            repeat: String,
            biometric: Boolean,
            available: Boolean,
        ): LockSettingsError? =
            when {
                pin.isNotEmpty() && (
                    pin.length != Limits.PIN_LENGTH ||
                        pin.any {
                            it !in '0'..'9'
                        }
                ) -> LockSettingsError.INVALID_PIN

                pin != repeat -> LockSettingsError.MISMATCH

                biometric && !available -> LockSettingsError.BIOMETRIC_UNAVAILABLE

                else -> null
            }

        companion object {
            val TIMEOUTS = listOf(60, 120, 300)
        }
    }
