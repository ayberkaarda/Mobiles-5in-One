package app.cetele.server.ops

import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MediaLifecycleTest {
    private val rules =
        JsonMapper
            .builder()
            .build()
            .readTree(Files.readString(Path.of("..", "ops", "backup", "media-lifecycle.json")))
            .path("Rules")
            .let { node -> (0 until node.size()).map { node.get(it) } }

    @Test
    fun `only processed photos and raw uploads have separate retention rules`() {
        assertEquals(2, rules.size)
        assertEquals(setOf("media/", "uploads/"), rules.map { it.path("Filter").path("Prefix").asString() }.toSet())
        assertEquals(2, rules.map { it.path("ID").asString() }.toSet().size)
        for ((prefix, days) in mapOf("media/" to 30, "uploads/" to 1)) {
            val rule = rules.single { it.path("Filter").path("Prefix").asString() == prefix }
            assertEquals("Enabled", rule.path("Status").asString())
            assertEquals(days, rule.path("NoncurrentVersionExpiration").path("NoncurrentDays").asInt())
            assertFalse(rule.path("NoncurrentVersionExpiration").has("NewerNoncurrentVersions"))
        }
    }

    @Test
    fun `both rules clean delete markers and incomplete multipart uploads without expiring current photos`() {
        for (rule in rules) {
            val expiration = rule.path("Expiration")
            assertTrue(expiration.path("ExpiredObjectDeleteMarker").asBoolean())
            assertFalse(expiration.has("Days"))
            assertFalse(expiration.has("Date"))
            assertEquals(1, rule.path("AbortIncompleteMultipartUpload").path("DaysAfterInitiation").asInt())
        }
    }
}
