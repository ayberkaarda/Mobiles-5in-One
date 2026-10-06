package app.cetele.server.web

import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import tools.jackson.core.util.DefaultIndenter
import tools.jackson.core.util.DefaultPrettyPrinter
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.util.TreeMap
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Exports the OpenAPI document to `build/openapi/openapi.json` on every test run (profile
 * `test`), the source for `docs/api/openapi.json` and `openApiContractCheck`.
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
        val indenter = DefaultIndenter("  ", "\n")
        val printer = DefaultPrettyPrinter().withObjectIndenter(indenter).withArrayIndenter(indenter)
        Files.writeString(target, json.writer().with(printer).writeValueAsString(canonical(document)) + "\n")
    }

    private fun canonical(node: JsonNode): Any? =
        when {
            node.isObject -> TreeMap(node.propertyNames().associateWith { canonical(node[it]) })
            node.isArray -> (0 until node.size()).map { canonical(node[it]) }
            else -> json.treeToValue(node, Any::class.java)
        }
}
