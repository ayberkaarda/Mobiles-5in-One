package app.cetele.server.admin

import app.cetele.server.security.CspNonceFilter
import app.cetele.server.security.SecurityHeadersConfig
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpSession
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@IntegrationTest
class AdminHeadersTest : AdminIntegrationTest() {
    @Test
    fun `every console response carries the csp nonce, no-store and noindex`() {
        val (_, admin) = admins.signedIn(AdminRole.ADMIN)
        val (_, support) = admins.signedIn(AdminRole.SUPPORT)
        val results =
            listOf(
                get("/admin/login", null),
                get("/admin", admin),
                get("/admin/shops?q=bakkal", admin),
                get("/admin/users", admin),
                get("/admin/admins", admin),
                get("/admin/audit", support),
                get("/admin/users/${UUID.randomUUID()}", admin),
                get("/admin/shops", null),
            )
        assertEquals(listOf(200, 200, 200, 200, 200, 403, 404, 302), results.map { it.response.status })
        results.forEach { result ->
            val response = result.response
            val nonce = result.request.getAttribute(CspNonceFilter.ATTRIBUTE) as String
            assertEquals(CspNonceFilter.policy(nonce), response.getHeader(CspNonceFilter.HEADER), result.request.requestURI)
            assertEquals("no-store", response.getHeader("Cache-Control"))
            assertEquals("noindex, nofollow", response.getHeader("X-Robots-Tag"))
            assertEquals("nosniff", response.getHeader("X-Content-Type-Options"))
            assertEquals("DENY", response.getHeader("X-Frame-Options"))
            assertEquals(SecurityHeadersConfig.HSTS, response.getHeader("Strict-Transport-Security"))
            if (response.status != 302) {
                val html = response.contentAsString
                assertTrue(html.contains("<html lang=\"tr\""), "Turkish page")
                assertTrue(html.contains("href=\"/assets/admin/admin.css\" nonce=\"$nonce\""), "stylesheet carries the nonce")
                assertTrue(html.contains("<meta name=\"robots\" content=\"noindex, nofollow\">"))
                assertTrue(!html.contains("<script", ignoreCase = true) && !html.contains("style=\"", ignoreCase = true))
            }
        }
    }

    @Test
    fun `the stylesheet is served`() {
        val response = mvc.get("/assets/admin/admin.css").andReturn().response
        assertEquals(200, response.status)
        assertTrue(response.contentAsString.contains("--primary"))
    }

    private fun get(
        path: String,
        session: MockHttpSession?,
    ): MvcResult =
        mvc
            .get(path) {
                secure = true
                if (session != null) this.session = session
            }.andReturn()
}
