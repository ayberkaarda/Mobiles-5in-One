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
import java.io.ByteArrayInputStream
import java.util.HexFormat
import javax.imageio.ImageIO
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class MediaCompleteTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val store: MediaStore,
) {
    @Test
    fun `renamed pdf and undecodable images fail persistently and delete originals`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val badImages =
            listOf(
                "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF".toByteArray(),
                byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xe0.toByte()),
            )
        badImages.forEach { bytes ->
            val id = f.id(f.presign(bytes.size))
            store.put(f.uploadKey(id), bytes, "image/jpeg")
            f.complete(id).expectProblem(422, "media.invalid")
            assertNull(store.head(f.uploadKey(id)))
            assertEquals("FAILED", f.status(id))
            assertEquals(
                "media.invalid",
                jdbc.queryForObject(
                    "SELECT failure_code FROM media_objects WHERE shop_id = ? AND id = ?",
                    String::class.java,
                    f.shopId,
                    id,
                ),
            )
        }
    }

    @Test
    fun `large jpeg is resized without exif and completion is idempotent`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val original = MediaFixtures.jpeg(2400, 1200)
        val marker = byteArrayOf(0xff.toByte(), 0xe1.toByte(), 0, 16) + "Exif".toByteArray() + byteArrayOf(0, 0) + ByteArray(8)
        val bytes = original.copyOfRange(0, 2) + marker + original.copyOfRange(2, original.size)
        val body = f.presign(bytes.size)
        val id = f.id(body)
        store.put(f.uploadKey(id), bytes, "image/jpeg")
        val response =
            f
                .complete(id)
                .andExpect { status { isOk() } }
                .andReturn()
                .response.contentAsString
        assertEquals(1600, JsonPath.read<Int>(response, "$.width"))
        assertEquals(800, JsonPath.read<Int>(response, "$.height"))
        assertEquals("READY", f.status(id))
        val result = store.get(f.key(body))
        val image = assertNotNull(ImageIO.read(ByteArrayInputStream(result)))
        assertEquals(1600, image.width)
        assertTrue(!String(result, Charsets.ISO_8859_1).contains("Exif"))
        assertEquals(result.size, JsonPath.read<Int>(response, "$.bytes"))
        assertNull(store.head(f.uploadKey(id)))
        assertEquals("image/jpeg", assertNotNull(store.head(f.key(body))).contentType)
        assertEquals(
            response,
            f
                .complete(id)
                .andReturn()
                .response.contentAsString,
        )
        assertContentEquals(result, store.get(f.key(body)))
    }

    @Test
    fun `webp is decoded and stored as jpeg`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val bytes = HexFormat.of().parseHex("524946461a000000574542505650384c0d0000002f00000010071011118888fe0700")
        val body = f.presign(bytes.size, "image/webp")
        val id = f.id(body)
        store.put(f.uploadKey(id), bytes, "image/webp")
        f.complete(id).andExpect { status { isOk() } }
        val result = store.get(f.key(body))
        assertEquals(0xff, result[0].toInt() and 0xff)
        assertEquals(0xd8, result[1].toInt() and 0xff)
        assertNotNull(ImageIO.read(ByteArrayInputStream(result)))
        assertNull(store.head(f.uploadKey(id)))
    }

    @Test
    fun `missing upload stays pending and an oversized upload fails`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val id = f.id(f.presign(100))
        f.complete(id).expectProblem(409, "media.not_uploaded")
        assertEquals("PENDING", f.status(id))
        store.put(f.uploadKey(id), ByteArray(101), "image/jpeg")
        f.complete(id).expectProblem(413, "media.too_large")
        assertEquals("FAILED", f.status(id))
        assertNull(store.head(f.uploadKey(id)))
        val large = f.id(f.presign(MediaStore.MAX_BYTES))
        store.put(f.uploadKey(large), ByteArray(MediaStore.MAX_BYTES + 1), "image/jpeg")
        f.complete(large).expectProblem(413, "media.too_large")
        assertNull(store.head(f.uploadKey(large)))
    }

    @Test
    fun `image dimensions are checked before decode`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val bytes = MediaFixtures.jpeg(6001, 1)
        val id = f.id(f.presign(bytes.size))
        store.put(f.uploadKey(id), bytes, "image/jpeg")
        f.complete(id).expectProblem(422, "media.invalid")
        assertEquals("FAILED", f.status(id))
        assertNull(store.head(f.uploadKey(id)))
    }
}
