package app.cetele.server.media

import app.cetele.server.media.store.MediaStore
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@IntegrationTest
class MediaPresignTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val store: MediaStore,
) {
    @Test
    fun `invalid lengths and types carry field codes`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        listOf(0, -1, 1_200_001).forEach { length ->
            val body =
                mvc
                    .post("/v1/shops/${f.shopId}/media/presign") {
                        header(AUTHORIZATION, f.owner.bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = """{"contentType":"image/jpeg","contentLength":$length}"""
                    }.expectProblem(422, "validation.failed")
            assertEquals("contentLength", JsonPath.read<String>(body, "$.errors[0].field"))
            assertEquals("out_of_range", JsonPath.read<String>(body, "$.errors[0].code"))
        }
        val body =
            mvc
                .post("/v1/shops/${f.shopId}/media/presign") {
                    header(AUTHORIZATION, f.owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"contentType":"application/pdf","contentLength":100}"""
                }.expectProblem(422, "validation.failed")
        assertEquals("contentType", JsonPath.read<String>(body, "$.errors[0].field"))
        assertEquals("invalid_format", JsonPath.read<String>(body, "$.errors[0].code"))
    }

    @Test
    fun `pending and ready slots count toward the monthly quota`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        repeat(200) { index ->
            val id = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO media_objects (id, shop_id, status, declared_content_type, declared_length, upload_key, photo_key, upload_expires_at, ready_at) VALUES (?, ?, ?, 'image/jpeg', 100, ?, ?, now() + interval '10 minutes', now())",
                id,
                f.shopId,
                if (index % 2 == 0) "PENDING" else "READY",
                f.uploadKey(id),
                "media/${f.shopId}/$id.jpg",
            )
        }
        mvc
            .post("/v1/shops/${f.shopId}/media/presign") {
                header(AUTHORIZATION, f.owner.bearer)
                contentType = MediaType.APPLICATION_JSON
                content = """{"contentType":"image/jpeg","contentLength":100}"""
            }.expectProblem(409, "plan.photo_limit")
        assertEquals(200, jdbc.queryForObject("SELECT count(*) FROM media_objects WHERE shop_id = ?", Int::class.java, f.shopId))
        jdbc.update("UPDATE shops SET plan = 'PRO' WHERE id = ?", f.shopId)
        f.presign(100)
    }

    @Test
    fun `signed headers upload and a changed length is refused`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val bytes = MediaFixtures.jpeg()
        val body = f.presign(bytes.size)
        assertEquals(
            mapOf("Content-Type" to "image/jpeg", "Content-Length" to bytes.size.toString()),
            JsonPath.read<Map<String, String>>(body, "$.headers"),
        )
        assertEquals("PUT", JsonPath.read<String>(body, "$.method"))
        assertTrue(JsonPath.read<String>(body, "$.uploadUrl").contains("X-Amz-SignedHeaders="))
        assertTrue(f.putSigned(body, bytes) in 200..299)
        assertEquals(bytes.size.toLong(), assertNotNull(store.head(f.uploadKey(f.id(body)))).length)
        val other = f.presign(bytes.size)
        assertTrue(f.putSigned(other, bytes + byteArrayOf(1)) in 400..499)
    }
}
