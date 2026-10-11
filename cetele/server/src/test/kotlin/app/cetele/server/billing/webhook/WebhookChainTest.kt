package app.cetele.server.billing.webhook

import app.cetele.server.billing.BillingTestSupport
import app.cetele.server.security.SecurityHeadersConfig
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.post
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The RTDN chain (`@Order(20)`) keeps the security headers, creates no session and leaves every other path to the API chain. */
@IntegrationTest
class WebhookChainTest : BillingTestSupport() {
    private val body get() = envelope(subscriptionNotification(token("active", UUID.randomUUID()), 4))

    @Test
    fun `security headers are present on accepted and refused deliveries`() {
        val accepted = push(body).andReturn().response
        assertEquals(200, accepted.status)
        val refused = push(body, null).andReturn().response
        assertEquals(401, refused.status)
        listOf(accepted, refused).forEach { assertHeaders(it) }
    }

    @Test
    fun `no session cookie is created`() {
        val result = push(body).andReturn()
        assertNull(result.response.getHeader("Set-Cookie"))
        assertNull(result.request.getSession(false))
    }

    @Test
    fun `the api chain still answers 401 for other paths`() {
        mvc
            .post("/v1/webhooks/other") {
                contentType = MediaType.APPLICATION_JSON
                content = "{}"
            }.expectProblem(401, "auth.unauthenticated")
        mvc
            .post("/v1/webhooks/play-rtdn/extra") {
                contentType = MediaType.APPLICATION_JSON
                content = "{}"
            }.expectProblem(401, "auth.unauthenticated")
        mvc.post("/v1/shops").expectProblem(401, "auth.unauthenticated")
    }

    @Test
    fun `an api access token does not authenticate the webhook`() {
        val user = auth.user()
        push(body, auth.bearer(user)).expectProblem(401, "webhook.unauthenticated")
    }

    private fun assertHeaders(response: MockHttpServletResponse) {
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"))
        assertEquals("DENY", response.getHeader("X-Frame-Options"))
        assertEquals("strict-origin-when-cross-origin", response.getHeader("Referrer-Policy"))
        assertEquals(SecurityHeadersConfig.PERMISSIONS_POLICY, response.getHeader("Permissions-Policy"))
        assertEquals("no-store", response.getHeader("Cache-Control"))
        assertNotNull(response.getHeader("Content-Security-Policy"))
        assertTrue(response.getHeader("Content-Security-Policy")!!.startsWith("default-src 'none'"))
        assertNull(response.getHeader("Strict-Transport-Security"))
    }
}
