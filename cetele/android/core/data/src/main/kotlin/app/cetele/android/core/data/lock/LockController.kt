package app.cetele.android.core.data.lock

import app.cetele.android.core.data.settings.SettingsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

sealed interface LockState {
    data object NoPin : LockState

    data object Locked : LockState

    data object Unlocked : LockState
}

@Singleton
class LockController
    @Inject
    constructor(
        private val pins: PinStore,
        private val settings: SettingsRepository,
        private val clock: ElapsedClock,
    ) {
        private val mutableState = MutableStateFlow<LockState>(if (pins.isSet()) LockState.Locked else LockState.NoPin)
        val state = mutableState.asStateFlow()
        private var coldStart = true
        private var backgroundedAt: Long? = null

        suspend fun onAppStart() {
            val current = settings.current()
            mutableState.value =
                when {
                    !pins.isSet() -> LockState.NoPin

                    LockPolicy.shouldLock(
                        backgroundedAt,
                        clock.millis(),
                        current.lockTimeoutSeconds,
                        coldStart,
                    ) -> LockState.Locked

                    else -> mutableState.value
                }
            coldStart = false
        }

        suspend fun onAppStop() {
            backgroundedAt = clock.millis()
        }

        fun unlock() {
            mutableState.value = if (pins.isSet()) LockState.Unlocked else LockState.NoPin
        }

        fun reset() {
            coldStart = true
            backgroundedAt = null
            mutableState.value = LockState.NoPin
        }
    }
