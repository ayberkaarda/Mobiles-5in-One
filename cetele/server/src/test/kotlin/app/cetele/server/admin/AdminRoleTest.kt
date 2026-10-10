package app.cetele.server.admin

import app.cetele.server.admin.web.AdminDenied
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.TenancyFixtures
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.mock.web.MockHttpSession
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Every console route of ADR-0033 for `ADMIN`, `SUPPORT`, anonymous callers and `/v1` users. */
@IntegrationTest
class AdminRoleTest : AdminIntegrationTest() {
    private data class Route(
        val method: String,
        val path: String,
        val adminOnly: Boolean,
        val params: Map<String, String> = emptyMap(),
    )

    private data class World(
        val shopId: UUID,
        val userId: UUID,
        val phone: String,
        val deviceRowId: UUID,
        val targetAdmin: UUID,
    )

    private fun world(): World {
        val fixtures = TenancyFixtures(mvc, auth, jdbc)
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val deviceRowId = TraceIdFilter.uuidV7()
        jdbc.update(
            "INSERT INTO devices (id, user_id, device_id, model, app_version, last_seen_at) VALUES (?, ?, ?, 'Pixel 8', '1.4.0', now())",
            deviceRowId,
            owner.id,
            UUID.randomUUID(),
        )
        return World(shopId, owner.id, owner.phone, deviceRowId, admins.admin(AdminRole.SUPPORT).id)
    }

    private fun reads(w: World) =
        listOf(
            Route("GET", "/admin", false),
            Route("GET", "/admin/shops", false, mapOf("q" to "Bakkal")),
            Route("GET", "/admin/shops/${w.shopId}", false),
            Route("GET", "/admin/users", false, mapOf("phone" to w.phone)),
            Route("GET", "/admin/users/${w.userId}", false),
            Route("GET", "/admin/account/password", false),
            Route("GET", "/admin/audit", true),
            Route("GET", "/admin/admins", true),
            Route("GET", "/admin/admins/new", true),
        )

    private fun writes(w: World) =
        listOf(
            Route("POST", "/admin/users/${w.userId}/deactivate", true),
            Route("POST", "/admin/users/${w.userId}/reactivate", true),
            Route("POST", "/admin/users/${w.userId}/devices/${w.deviceRowId}/revoke", true),
            Route(
                "POST",
                "/admin/admins/new",
                true,
                mapOf(
                    "email" to "yeni-${UUID.randomUUID().toString().take(8)}@cetele.test",
                    "role" to "SUPPORT",
                ),
            ),
            Route("POST", "/admin/admins/${w.targetAdmin}/role", true, mapOf("role" to "ADMIN")),
            Route("POST", "/admin/admins/${w.targetAdmin}/disable", true),
            Route("POST", "/admin/admins/${w.targetAdmin}/enable", true),
            Route("POST", "/admin/admins/${w.targetAdmin}/totp-reset", true),
        )

    private fun call(
        route: Route,
        session: MockHttpSession?,
        bearer: String? = null,
    ): MockHttpServletResponse =
        if (route.method == "GET") {
            mvc
                .get(route.path) {
                    if (session != null) this.session = session
                    if (bearer != null) header(HttpHeaders.AUTHORIZATION, bearer)
                    route.params.forEach { (k, v) -> param(k, v) }
                }.andReturn()
                .response
        } else {
            mvc
                .post(route.path) {
                    if (session != null) this.session = session
                    if (bearer != null) header(HttpHeaders.AUTHORIZATION, bearer)
                    with(csrf())
                    route.params.forEach { (k, v) -> param(k, v) }
                }.andReturn()
                .response
        }

    @Test
    fun `admin reaches every route`() {
        val w = world()
        val (_, session) = admins.signedIn(AdminRole.ADMIN)
        reads(w).forEach { route ->
            assertEquals(200, call(route, session).status, "${route.method} ${route.path}")
        }
        writes(w).forEach { route ->
            val response = call(route, session)
            assertTrue(response.status == 302 || response.status == 200, "${route.method} ${route.path} answered ${response.status}")
        }
    }

    @Test
    fun `support reads but every admin route and every action is 403`() {
        val w = world()
        val (_, session) = admins.signedIn(AdminRole.SUPPORT)
        reads(w).forEach { route ->
            val response = call(route, session)
            if (route.adminOnly) {
                assertEquals(403, response.status, "${route.method} ${route.path}")
                assertTrue(response.contentAsString.contains(AdminDenied.NO_PERMISSION))
            } else {
                assertEquals(200, response.status, "${route.method} ${route.path}")
            }
        }
        writes(w).forEach { route ->
            assertEquals(403, call(route, session).status, "${route.method} ${route.path}")
        }
        assertEquals(
            1,
            jdbc.queryForObject("SELECT count(*) FROM users WHERE id = ? AND deactivated_at IS NULL", Int::class.java, w.userId),
        )
        assertEquals("SUPPORT", jdbc.queryForObject("SELECT role FROM admin_users WHERE id = ?", String::class.java, w.targetAdmin))
        assertEquals(
            1,
            jdbc.queryForObject("SELECT count(*) FROM admin_users WHERE id = ? AND disabled_at IS NULL", Int::class.java, w.targetAdmin),
        )
    }

    @Test
    fun `anonymous callers and api users are sent to the login page`() {
        val w = world()
        val bearer = auth.bearer(w.userId)
        (reads(w) + writes(w)).forEach { route ->
            listOf(null to null, null to bearer).forEach { (session, header) ->
                val response = call(route, session, header)
                assertEquals(
                    302,
                    response.status,
                    "${route.method} ${route.path} with ${if (header == null) "no credentials" else "a /v1 token"}",
                )
                assertEquals("/admin/login", response.redirectedUrl ?: response.getHeader(HttpHeaders.LOCATION))
            }
        }
        assertEquals(
            1,
            jdbc.queryForObject("SELECT count(*) FROM users WHERE id = ? AND deactivated_at IS NULL", Int::class.java, w.userId),
        )
    }

    @Test
    fun `unknown console paths are refused`() {
        val (_, session) = admins.signedIn(AdminRole.SUPPORT)
        assertEquals(
            403,
            mvc
                .get("/admin/ledger") { this.session = session }
                .andReturn()
                .response.status,
        )
        assertEquals(
            302,
            mvc
                .get("/admin/ledger")
                .andReturn()
                .response.status,
        )
    }

    @Test
    fun `a malformed id is a console 404`() {
        val (_, session) = admins.signedIn(AdminRole.SUPPORT)
        val response = mvc.get("/admin/shops/bir-dukkan") { this.session = session }.andReturn().response
        assertEquals(404, response.status)
        assertTrue(response.contentType!!.startsWith("text/html"))
        assertEquals(
            404,
            mvc
                .get("/admin/users/${UUID.randomUUID()}") { this.session = session }
                .andReturn()
                .response.status,
        )
    }
}
