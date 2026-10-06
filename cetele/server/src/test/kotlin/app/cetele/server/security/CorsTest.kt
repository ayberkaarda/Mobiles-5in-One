package app.cetele.server.security

import app.cetele.server.config.SecurityConfig
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.context.ApplicationContext
import org.springframework.http.HttpHeaders
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.options
import org.springframework.test.web.servlet.post
import org.springframework.web.filter.CorsFilter
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The API has no browser clients: no CORS configuration, no `Access-Control-*` header, ever. */
@IntegrationTest
class CorsTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val context: ApplicationContext,
) {
    private val origins = listOf("https://evil.example", "https://cetele.app", "null")
    private val paths =
        listOf("/actuator/health", "/v1/me", ProbeController.BASE + "/me", "/v1/shops/x") + SecurityConfig.PUBLIC_AUTH_PATHS

    @Test
    fun `preflight from any origin gets no cors headers`() {
        origins.forEach { origin ->
            paths.forEach { path ->
                val response =
                    mvc
                        .options(path) {
                            header(HttpHeaders.ORIGIN, origin)
                            header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                            header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "authorization,content-type")
                        }.andReturn()
                        .response
                assertNoCorsHeaders(response, "OPTIONS $path from $origin")
            }
        }
    }

    @Test
    fun `simple and credentialed requests with an origin get no cors headers`() {
        origins.forEach { origin ->
            assertNoCorsHeaders(mvc.get("/actuator/health") { header(HttpHeaders.ORIGIN, origin) }.andReturn().response, "health")
            val authorized =
                mvc
                    .get(ProbeController.BASE + "/me") {
                        header(HttpHeaders.ORIGIN, origin)
                        header(HttpHeaders.AUTHORIZATION, auth.bearer(auth.user()))
                    }.andReturn()
                    .response
            assertNoCorsHeaders(authorized, "authorized GET")
            assertNoCorsHeaders(mvc.post("/v1/auth/otp/request") { header(HttpHeaders.ORIGIN, origin) }.andReturn().response, "otp")
        }
    }

    @Test
    fun `no cors filter or configuration source is registered`() {
        assertTrue(context.getBeanNamesForType(CorsFilter::class.java).isEmpty())
        // Spring Security switches CORS on when a bean with this name exists.
        assertFalse(context.containsBean("corsConfigurationSource"))
    }

    private fun assertNoCorsHeaders(
        response: MockHttpServletResponse,
        label: String,
    ) {
        val corsHeaders = response.headerNames.filter { it.startsWith("Access-Control-", ignoreCase = true) }
        assertTrue(corsHeaders.isEmpty(), "$label returned $corsHeaders")
    }
}
