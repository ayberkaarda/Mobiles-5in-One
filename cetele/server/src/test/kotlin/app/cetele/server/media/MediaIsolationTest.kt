package app.cetele.server.media

import app.cetele.server.media.store.MediaStore
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import app.cetele.server.tenancy.TenancyFixtures.Companion.withoutTraceId
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import java.util.UUID
import kotlin.test.assertEquals

@IntegrationTest
class MediaIsolationTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val store: MediaStore,
) {
    @Test
    fun `foreign complete and download have the same not found body as missing media`() {
        val a = MediaFixtures(mvc, auth, jdbc, store)
        val b = MediaFixtures(mvc, auth, jdbc, store)
        val id = b.ready()
        val staff = a.tenancy.addStaff(a.shopId)
        listOf(a.owner, staff, a.tenancy.actor()).forEach { actor ->
            val complete = b.complete(id, actor).expectProblem(404, "not_found")
            val download = b.download(id, actor).expectProblem(404, "not_found")
            assertEquals(withoutTraceId(complete), withoutTraceId(download))
            assertEquals(withoutTraceId(complete), withoutTraceId(a.complete(UUID.randomUUID()).expectProblem(404, "not_found")))
        }
        a.complete(id).expectProblem(404, "not_found")
        a.download(id).expectProblem(404, "not_found")
        assertEquals("READY", b.status(id))
    }
}
