package app.cetele.android.core.data.settings

import androidx.datastore.core.CorruptionException
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class UserSettingsSerializerTest {
    @Test
    fun `round trips non default values`() =
        runTest {
            val settings = UserSettings(lockTimeoutSeconds = 300, biometricUnlockEnabled = true)
            val output = ByteArrayOutputStream()

            UserSettingsSerializer.writeTo(settings, output)
            val restored = UserSettingsSerializer.readFrom(ByteArrayInputStream(output.toByteArray()))

            assertEquals(settings, restored)
        }

    @Test
    fun `empty file reads as defaults`() =
        runTest {
            val restored = UserSettingsSerializer.readFrom(ByteArrayInputStream(ByteArray(0)))

            assertEquals(UserSettings(), restored)
            assertEquals(UserSettings.DEFAULT_LOCK_TIMEOUT_SECONDS, restored.lockTimeoutSeconds)
        }

    @Test
    fun `truncated file is reported as corruption`() =
        runTest {
            val truncated = byteArrayOf(FIELD_ONE_VARINT_TAG)

            val result = runCatching { UserSettingsSerializer.readFrom(ByteArrayInputStream(truncated)) }

            assertTrue(result.exceptionOrNull() is CorruptionException)
        }

    private companion object {
        const val FIELD_ONE_VARINT_TAG: Byte = 0x08
    }
}
