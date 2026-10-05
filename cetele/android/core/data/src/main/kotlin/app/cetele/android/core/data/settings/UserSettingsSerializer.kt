package app.cetele.android.core.data.settings

import androidx.datastore.core.CorruptionException
import androidx.datastore.core.Serializer
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerializationException
import kotlinx.serialization.protobuf.ProtoBuf
import java.io.InputStream
import java.io.OutputStream

/** Protocol Buffers encoding of [UserSettings] for Proto DataStore. */
@OptIn(ExperimentalSerializationApi::class)
object UserSettingsSerializer : Serializer<UserSettings> {
    override val defaultValue: UserSettings = UserSettings()

    override suspend fun readFrom(input: InputStream): UserSettings =
        try {
            ProtoBuf.decodeFromByteArray(UserSettings.serializer(), input.readBytes())
        } catch (exception: SerializationException) {
            throw CorruptionException("Settings file cannot be decoded", exception)
        }

    override suspend fun writeTo(
        t: UserSettings,
        output: OutputStream,
    ) {
        output.write(ProtoBuf.encodeToByteArray(UserSettings.serializer(), t))
    }
}
