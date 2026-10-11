package app.cetele.server.security.xss

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures
import app.cetele.server.web.site.SiteRoutes
import jakarta.servlet.DispatcherType
import jakarta.servlet.RequestDispatcher
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.ACCEPT
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.web.util.UriUtils
import tools.jackson.databind.ObjectMapper
import java.net.URI
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Item 16 on the surfaces that take request input rather than stored data: every public site page
 * and its 404, the statement 404, Problem Details bodies, the error dispatch and the console login
 * failure page. Request values must never come back as markup, and JSON errors never as HTML.
 */
@IntegrationTest
class ReflectedSurfaceXssTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val mapper: ObjectMapper,
) {
    private fun ip(): String = "10.${(1..3).joinToString(".") { (1..254).random().toString() }}"

    private fun get(
        path: String,
        accept: String? = null,
    ): MockHttpServletResponse =
        mvc
            .get(URI.create(path)) {
                if (accept != null) header(ACCEPT, accept)
                with { it.apply { remoteAddr = ip() } }
            }.andReturn()
            .response

    /** One path segment, percent-encoded once (the request is built from a [URI], so it is not encoded again). */
    private fun segment(value: String): String = UriUtils.encodePathSegment(value, Charsets.UTF_8)

    /**
     * A request the firewall refuses before any handler (an encoded slash, percent or backslash) gets an
     * empty 400; anything that reaches the application must be a problem body.
     */
    private fun assertRefusedOrProblem(
        response: MockHttpServletResponse,
        where: String,
        payload: String,
    ) {
        if (response.contentAsString.isEmpty() && response.contentType == null) {
            // No body and no media type: nothing a browser could render or sniff.
            assertEquals(400, response.status, where)
        } else {
            assertProblem(response, response.status, where, payload)
        }
    }

    private fun assertProblem(
        response: MockHttpServletResponse,
        status: Int,
        where: String,
        payload: String? = null,
        headers: Boolean = true,
    ) {
        assertEquals(status, response.status, "$where: ${response.contentAsString}")
        assertEquals(MediaType.APPLICATION_PROBLEM_JSON_VALUE, response.contentType, "$where: problem media type, never html")
        if (headers) HtmlInspector.assertHeaders(response, where)
        val body = mapper.readTree(response.contentAsString)
        assertTrue(body.isObject, where)
        assertFalse(body.has("detail") || body.has("instance") || body.has("trace") || body.has("message"), "$where: $body")
        if (payload != null) assertFalse(response.contentAsString.contains(payload), "$where: the submitted value is echoed")
    }

    @Test
    fun `every public site page is free of script and handlers under a script-none policy`() {
        SiteRoutes.all.forEach { route ->
            val response = get(route.path)
            assertEquals(200, response.status, route.path)
            val directives = HtmlInspector.assertHeaders(response, route.path)
            assertEquals(listOf("'none'"), directives["script-src"], route.path)
            assertFalse(directives.values.flatten().any { it.startsWith("'nonce-") }, "${route.path}: fixed policy")
            val html = response.contentAsString
            HtmlInspector.assertInert(html, route.path, allowSvg = true, allowJsonLd = true)
            val tags = HtmlInspector.tags(html)
            assertTrue(tags.count { it.name == "script" } <= 1, "${route.path}: at most the JSON-LD block")
            Regex("""<script type="application/ld\+json">([\s\S]*?)</script>""").findAll(html).forEach { block ->
                assertFalse(block.groupValues[1].contains('<'), "${route.path}: JSON-LD escapes '<'")
                mapper.readTree(block.groupValues[1])
            }
        }
    }

    @Test
    fun `site 404 pages do not reflect the requested slug`() {
        XssCorpus.all.forEach { payload ->
            listOf(SiteRoutes.GUIDES_PREFIX, SiteRoutes.TRADES_PREFIX).forEach { prefix ->
                val response = get(prefix + segment(payload))
                val where = "site 404 [$payload]"
                if (response.status == 404 && response.contentType?.startsWith("text/html") == true) {
                    HtmlInspector.assertHeaders(response, where)
                    HtmlInspector.assertInert(response.contentAsString, where, allowSvg = true, allowJsonLd = true)
                    assertFalse(HtmlInspector.text(response.contentAsString).contains(payload), "$where: slug echoed")
                    assertFalse(
                        HtmlInspector.attributeValues(response.contentAsString).any { it.contains(payload) },
                        "$where: slug in an attribute",
                    )
                } else {
                    assertRefusedOrProblem(response, where, payload)
                }
            }
        }
    }

    @Test
    fun `statement 404 page does not reflect the token`() {
        XssCorpus.all.forEach { payload ->
            val response = get("/s/" + segment(payload))
            val where = "statement 404 [$payload]"
            if (response.contentType?.startsWith("text/html") == true) {
                assertEquals(404, response.status, where)
                HtmlInspector.assertHeaders(response, where)
                HtmlInspector.assertInert(response.contentAsString, where)
                assertFalse(
                    response.contentAsString.contains(segment(payload)) || HtmlInspector.text(response.contentAsString).contains(payload),
                    where,
                )
            } else {
                assertRefusedOrProblem(response, where, payload)
            }
        }
    }

    @Test
    fun `problem bodies stay json for html clients and never echo submitted values`() {
        val world = TenancyFixtures(mvc, auth, jdbc).world()
        XssCorpus.all.forEach { payload ->
            val where = "[$payload]"
            listOf(null, "text/html", "text/html,application/xhtml+xml,*/*;q=0.8").forEach { accept ->
                val response = get("/v1/" + segment(payload), accept)
                if (response.status == 404) {
                    assertProblem(response, 404, "unknown api route $where $accept", payload)
                } else {
                    assertRefusedOrProblem(response, "unknown api route $where $accept", payload)
                }
            }
            val invitation =
                mvc
                    .post("/v1/shops/${world.shopId}/invitations") {
                        header(AUTHORIZATION, world.owner.bearer)
                        header(ACCEPT, "text/html")
                        contentType = MediaType.APPLICATION_JSON
                        content = mapper.writeValueAsString(mapOf("phone" to payload))
                    }.andReturn()
                    .response
            assertProblem(invitation, 422, "invitation phone $where", payload)
            val shop =
                mvc
                    .post("/v1/shops") {
                        header(AUTHORIZATION, world.owner.bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content =
                            mapper.writeValueAsString(mapOf("name" to "Bakkal", "type" to payload, "il" to "İstanbul", "ilce" to "Kadıköy"))
                    }.andReturn()
                    .response
            assertProblem(shop, 422, "shop type $where", payload)
            val unknown =
                mvc
                    .post("/v1/shops") {
                        header(AUTHORIZATION, world.owner.bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content =
                            mapper.writeValueAsString(
                                mapOf(
                                    "name" to "Bakkal",
                                    "type" to "BAKKAL",
                                    "il" to "İstanbul",
                                    "ilce" to "Kadıköy",
                                    payload to 1,
                                ),
                            )
                    }.andReturn()
                    .response
            // The unknown property name is reported as the error's field: JSON text, served as problem+json with nosniff.
            assertProblem(unknown, 422, "unknown property $where")
            val accepted =
                mvc
                    .post(URI.create("/v1/invitations/${segment(payload)}/accept")) {
                        header(AUTHORIZATION, world.owner.bearer)
                    }.andReturn()
                    .response
            assertRefusedOrProblem(accepted, "invitation code $where", payload)
        }
    }

    @Test
    fun `the error dispatch answers with a problem body, not an html error page`() {
        XssCorpus.markup.forEach { payload ->
            val response =
                mvc
                    .get("/error") {
                        header(ACCEPT, "text/html")
                        with { it.apply { dispatcherType = DispatcherType.ERROR } }
                        requestAttr(RequestDispatcher.ERROR_STATUS_CODE, 500)
                        requestAttr(RequestDispatcher.ERROR_REQUEST_URI, "/" + payload)
                        requestAttr(RequestDispatcher.ERROR_MESSAGE, payload)
                        requestAttr(RequestDispatcher.ERROR_EXCEPTION, IllegalStateException(payload))
                    }.andReturn()
                    .response
            // A standalone error dispatch skips the header filters; on a container the original request wrote them.
            assertProblem(response, 500, "error dispatch [$payload]", payload, headers = false)
        }
    }

    @Test
    fun `console login failure page does not reflect the submitted email`() {
        XssCorpus.all.take(CONSOLE_ATTEMPTS).forEach { payload ->
            val response =
                mvc
                    .post("/admin/login") {
                        with(csrf())
                        with { it.apply { remoteAddr = ip() } }
                        param("email", payload)
                        param("password", payload)
                    }.andReturn()
                    .response
            val where = "console login [$payload]"
            assertTrue(response.status in setOf(200, 401), "$where: ${response.status}")
            HtmlInspector.assertHeaders(response, where)
            HtmlInspector.assertInert(response.contentAsString, where)
            assertFalse(HtmlInspector.text(response.contentAsString).contains(payload), "$where: email echoed")
            assertFalse(
                HtmlInspector.attributeValues(response.contentAsString).any { it.contains(payload) },
                "$where: email in an attribute",
            )
        }
    }

    private companion object {
        const val CONSOLE_ATTEMPTS = 15
    }
}
