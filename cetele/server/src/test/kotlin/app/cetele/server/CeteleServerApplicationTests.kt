package app.cetele.server

import app.cetele.server.config.StorageProperties
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.context.ApplicationContext
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@IntegrationTest
class CeteleServerApplicationTests(
    @Autowired private val context: ApplicationContext,
    @Autowired private val storage: StorageProperties,
) {
    @Test
    fun `context loads`() {
        assertTrue(context.containsBean("apiSecurityFilterChain"))
    }

    @Test
    fun `storage settings bind with documented defaults`() {
        assertEquals("auto", storage.region)
        assertEquals("cetele-media", storage.bucketMedia)
        assertTrue(storage.pathStyle)
        assertFalse(storage.toString().contains("secretKey"))
    }
}
