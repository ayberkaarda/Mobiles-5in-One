package app.cetele.server.web

import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.SerializationFeature
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Exports the OpenAPI document to `build/openapi/openapi.json` on every test run (profile
 * `test`), the source for `docs/api/openapi.json`. Comparing against the committed copy is Phase 2.
 */
@IntegrationTest
class OpenApiSnapshotTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val json: ObjectMapper,
) {
    @Test
    fun `openapi document is exported`() {
        val body =
            mvc
                .get("/v3/api-docs")
                .andExpect { status { isOk() } }
                .andReturn()
                .response.contentAsString
        val document = json.readTree(body)
        assertTrue(document["openapi"].asString().startsWith("3."))
        assertEquals("Cetele API", document["info"]["title"].asString())
        assertEquals("bearer", document["components"]["securitySchemes"]["bearerAuth"]["scheme"].asString())
        assertEquals("https://cetele.app", document["servers"].single()["url"].asString())
        val paths = document["paths"]?.propertyNames()?.toList().orEmpty()
        assertTrue(paths.all { it.startsWith("/v1/") }, "only /v1 is documented: $paths")
        assertFalse(paths.any { it.contains("test-probe") }, "test endpoints must stay hidden")

        val target = Path.of("build", "openapi", "openapi.json")
        Files.createDirectories(target.parent)
        Files.writeString(target, json.writer().with(SerializationFeature.INDENT_OUTPUT).writeValueAsString(document) + "\n")
    }
}
