package app.cetele.server.media

import app.cetele.server.media.store.MediaStore
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

@IntegrationTest
class MediaSweeperTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val store: MediaStore,
    @Autowired private val sweeper: MediaSweeper,
) {
    @Test
    fun `only pending uploads older than the full grace are expired`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS)
        val stale = f.id(f.presign(100))
        val boundary = f.id(f.presign(100))
        val fresh = f.id(f.presign(100))
        val ready = f.ready()
        listOf(stale, boundary, fresh).forEach { store.put(f.uploadKey(it), byteArrayOf(1), "image/jpeg") }
        val cutoff = now.minus(Duration.ofHours(24))
        jdbc.update(
            "UPDATE media_objects SET upload_expires_at = ? WHERE shop_id = ? AND id = ?",
            Timestamp.from(cutoff.minusSeconds(1)),
            f.shopId,
            stale,
        )
        jdbc.update(
            "UPDATE media_objects SET upload_expires_at = ? WHERE shop_id = ? AND id = ?",
            Timestamp.from(cutoff),
            f.shopId,
            boundary,
        )
        jdbc.update(
            "UPDATE media_objects SET upload_expires_at = ? WHERE shop_id = ? AND id = ?",
            Timestamp.from(cutoff.minusSeconds(1)),
            f.shopId,
            ready,
        )
        assertEquals(1, sweeper.sweep(now))
        assertEquals("EXPIRED", f.status(stale))
        assertNull(store.head(f.uploadKey(stale)))
        assertEquals("PENDING", f.status(boundary))
        assertNotNull(store.head(f.uploadKey(boundary)))
        assertNotNull(store.head(f.uploadKey(fresh)))
        assertEquals("READY", f.status(ready))
        assertEquals(0, sweeper.sweep(now))
    }

    @Test
    fun `a replayed upload after completion is removed once the url has expired`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS)
        val ready = f.ready()
        store.put(f.uploadKey(ready), byteArrayOf(1), "image/jpeg")
        sweeper.sweep(now)
        assertNotNull(store.head(f.uploadKey(ready)))
        sweeper.sweep(now.plus(Duration.ofMinutes(11)))
        assertNull(store.head(f.uploadKey(ready)))
        assertEquals("READY", f.status(ready))
        assertNotNull(store.head("media/${f.shopId}/$ready.jpg"))
    }
}
