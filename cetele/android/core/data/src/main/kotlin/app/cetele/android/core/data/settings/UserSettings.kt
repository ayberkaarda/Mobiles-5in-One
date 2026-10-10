package app.cetele.android.core.data.settings

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.protobuf.ProtoNumber

@Serializable enum class ThemeMode { SYSTEM, LIGHT, DARK }

/** Protobuf field numbers are the on-disk format: never renumber or reuse one. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@Suppress("MagicNumber")
data class UserSettings(
    @ProtoNumber(1) val lockTimeoutSeconds: Int = DEFAULT_LOCK_TIMEOUT_SECONDS,
    @ProtoNumber(2) val biometricUnlockEnabled: Boolean = false,
    @ProtoNumber(3) val activeShopId: String? = null,
    @ProtoNumber(4) val themeMode: ThemeMode = ThemeMode.SYSTEM,
    @ProtoNumber(5) val deviceId: String? = null,
    @ProtoNumber(6) val backgroundedAtEpochMillis: Long? = null,
    @ProtoNumber(7) val pinSetupDone: Boolean = false,
) {
    companion object {
        const val DEFAULT_LOCK_TIMEOUT_SECONDS = 120
    }
}
