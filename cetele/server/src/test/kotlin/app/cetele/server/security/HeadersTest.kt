package app.cetele.server.security

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import java.util.Base64
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class HeadersTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
) {
    private val hsts = "max-age=63072000; includeSubDomains; preload"

    @Test
    fun `public response carries every security header`() {
        val response = mvc.get("/actuator/health") { secure = true }.andReturn().response
        assertSecurityHeaders(response)
    }

    @Test
    fun `401 response carries the same headers`() {
        val response = mvc.get("/v1/me") { secure = true }.andReturn().response
        assertEquals(401, response.status)
        assertSecurityHeaders(response)
        assertEquals("no-store", response.getHeader(HttpHeaders.CACHE_CONTROL))
    }

    @Test
    fun `api responses are never cached`() {
        val response =
            mvc
                .get(ProbeController.BASE + "/me") {
                    secure = true
                    header(HttpHeaders.AUTHORIZATION, auth.bearer(auth.user()))
                }.andReturn()
                .response
        assertEquals(200, response.status)
        assertSecurityHeaders(response)
        assertEquals("no-store", response.getHeader(HttpHeaders.CACHE_CONTROL))
        assertEquals("no-cache", response.getHeader(HttpHeaders.PRAGMA))
    }

    @Test
    fun `hsts is only sent over https`() {
        val response = mvc.get("/actuator/health").andReturn().response
        assertNull(response.getHeader("Strict-Transport-Security"))
        assertNotNull(response.getHeader(CspNonceFilter.HEADER))
    }

    @Test
    fun `csp nonce is 128 bit, fresh per request and exposed to templates`() {
        val first = mvc.get("/actuator/health") { secure = true }.andReturn()
        val second = mvc.get("/actuator/health") { secure = true }.andReturn()
        val nonce = first.request.getAttribute(CspNonceFilter.ATTRIBUTE) as String
        val otherNonce = second.request.getAttribute(CspNonceFilter.ATTRIBUTE) as String
        assertEquals(16, Base64.getDecoder().decode(nonce).size)
        assertNotEquals(nonce, otherNonce)
        assertEquals(CspNonceFilter.policy(nonce), first.response.getHeader(CspNonceFilter.HEADER))
        assertEquals(CspNonceFilter.policy(otherNonce), second.response.getHeader(CspNonceFilter.HEADER))
    }

    private fun assertSecurityHeaders(response: MockHttpServletResponse) {
        assertEquals(hsts, response.getHeader("Strict-Transport-Security"))
        val csp = assertNotNull(response.getHeader(CspNonceFilter.HEADER))
        val expectedShape =
            Regex(
                "default-src 'none'; script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'; style-src 'self' 'nonce-\\1'; " +
                    "img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            )
        assertTrue(expectedShape.matches(csp), "unexpected CSP: $csp")
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"))
        assertEquals("strict-origin-when-cross-origin", response.getHeader("Referrer-Policy"))
        assertEquals("camera=(), geolocation=(), microphone=()", response.getHeader("Permissions-Policy"))
        assertEquals("DENY", response.getHeader("X-Frame-Options"))
    }
}
