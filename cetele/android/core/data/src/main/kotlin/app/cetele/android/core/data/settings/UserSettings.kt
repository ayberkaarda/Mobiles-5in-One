package app.cetele.android.core.data.settings

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.protobuf.ProtoNumber

/** Device-local preferences, stored with Proto DataStore. Field numbers are part of the file format. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class UserSettings(
    @ProtoNumber(1) val lockTimeoutSeconds: Int = DEFAULT_LOCK_TIMEOUT_SECONDS,
    @ProtoNumber(2) val biometricUnlockEnabled: Boolean = false,
) {
    companion object {
        /** The app asks for the PIN again after two minutes in the background. */
        const val DEFAULT_LOCK_TIMEOUT_SECONDS: Int = 120
    }
}
