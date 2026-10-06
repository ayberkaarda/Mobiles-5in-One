package app.cetele.server.media

import app.cetele.server.media.store.MediaStore
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.TestAuth
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc

@IntegrationTest
@LogCapture
class MediaLogSampleTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val store: MediaStore,
) {
    @Test
    fun `upload complete and download log outcomes without keys or urls`(output: CapturedOutput) {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val bytes = MediaFixtures.jpeg()
        val upload = f.presign(bytes.size)
        val id = f.id(upload)
        store.put(f.uploadKey(id), bytes, "image/jpeg")
        f.complete(id).andExpect { status { isOk() } }
        val download =
            f
                .download(id)
                .andExpect { status { isOk() } }
                .andReturn()
                .response.contentAsString
        output.assertContains("outcome=pending")
        output.assertContains("outcome=ready")
        output.assertNoneOf(
            f.uploadKey(id),
            f.key(upload),
            JsonPath.read<String>(upload, "$.uploadUrl"),
            JsonPath.read<String>(download, "$.downloadUrl"),
            f.owner.bearer,
            f.owner.phone,
        )
    }
}
