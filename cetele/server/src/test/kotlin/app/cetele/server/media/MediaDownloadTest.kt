package app.cetele.server.media

import app.cetele.server.media.store.MediaStore
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.time.Instant
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@IntegrationTest
class MediaDownloadTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val store: MediaStore,
) {
    @Test
    fun `only ready objects have a working ten minute download`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val id = f.id(f.presign(100))
        f.download(id).expectProblem(409, "media.not_ready")
        store.put(f.uploadKey(id), MediaFixtures.jpeg(), "image/jpeg")
        val readyId = f.ready()
        val start = Instant.now()
        val body =
            f
                .download(readyId)
                .andExpect { status { isOk() } }
                .andReturn()
                .response.contentAsString
        assertEquals("READY", JsonPath.read<String>(body, "$.status"))
        assertEquals(readyId.toString(), JsonPath.read<String>(body, "$.mediaId"))
        val expires = Instant.parse(JsonPath.read<String>(body, "$.expiresAt"))
        assertTrue(Duration.between(start, expires).seconds in 590..610)
        val request = HttpRequest.newBuilder(URI.create(JsonPath.read<String>(body, "$.downloadUrl"))).GET().build()
        val response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofByteArray())
        assertEquals(200, response.statusCode())
        assertContentEquals(store.get(JsonPath.read<String>(body, "$.photoKey")), response.body())
    }

    @Test
    fun `prefix deletion keeps neighboring shops objects`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val own = "media/${f.shopId}/"
        val other = "media/${java.util.UUID.randomUUID()}/"
        store.put(own + "first.jpg", byteArrayOf(1), "image/jpeg")
        store.put(own + "second.jpg", byteArrayOf(2), "image/jpeg")
        store.put(other + "keep.jpg", byteArrayOf(3), "image/jpeg")
        store.deletePrefix(own)
        kotlin.test.assertNull(store.head(own + "first.jpg"))
        kotlin.test.assertNull(store.head(own + "second.jpg"))
        kotlin.test.assertNotNull(store.head(other + "keep.jpg"))
    }
}
