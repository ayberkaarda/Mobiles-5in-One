package app.cetele.server.admin

import app.cetele.server.admin.AdminTestSupport.Companion.assertRedirect
import app.cetele.server.admin.AdminTestSupport.Companion.sessionOf
import app.cetele.server.admin.web.AdminDenied
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.mock.web.MockHttpSession
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.time.Duration
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

@IntegrationTest
class AdminSessionTest : AdminIntegrationTest() {
    @Test
    fun `session id changes at each step`() {
        val admin = admins.admin(enrolled = true, mustChangePassword = true)
        val ip = admins.randomIp()
        val loginPage = mvc.get("/admin/login").andReturn()
        val initial = sessionOf(loginPage)
        val initialId = initial.id

        val afterPassword = admins.post("/admin/login", initial, ip, "email" to admin.email, "password" to admin.password)
        val pending = sessionOf(afterPassword)
        val pendingId = pending.id
        assertNotEquals(initialId, pendingId, "the password step starts a new session")

        val afterTotp = admins.post("/admin/login/totp", pending, ip, "code" to admins.code(admin.secret!!))
        assertRedirect(afterTotp.response, "/admin/account/password")
        val forced = sessionOf(afterTotp)
        val forcedId = forced.id
        assertNotEquals(pendingId, forcedId)

        val password = "[ÖRNEK] yepyeni parola"
        val granted = admins.post("/admin/account/password", forced, ip, "newPassword" to password, "confirmPassword" to password)
        assertRedirect(granted.response, "/admin")
        assertNotEquals(forcedId, sessionOf(granted).id, "granting the role changes the session id again")
    }

    @Test
    fun `the session idles out after thirty minutes`() {
        val (_, session) = admins.signedIn()
        assertEquals(Duration.ofMinutes(30).toSeconds().toInt(), session.maxInactiveInterval)

        session.setAttribute(AdminSessionPolicy.LAST_SEEN_AT, Instant.now().minus(Duration.ofMinutes(29)))
        assertEquals(200, page("/admin", session).response.status)

        session.setAttribute(AdminSessionPolicy.LAST_SEEN_AT, Instant.now().minus(Duration.ofMinutes(31)))
        assertRedirect(page("/admin", session).response, "/admin/login")
        assertTrue(session.isInvalid)
    }

    @Test
    fun `the session ends twelve hours after the login whatever the activity`() {
        val (_, session) = admins.signedIn()
        session.setAttribute(AdminSessionPolicy.STARTED_AT, Instant.now().minus(Duration.ofHours(11)))
        assertEquals(200, page("/admin", session).response.status)
        session.setAttribute(AdminSessionPolicy.STARTED_AT, Instant.now().minus(Duration.ofHours(12)).minusSeconds(1))
        assertRedirect(page("/admin", session).response, "/admin/login")
        assertTrue(session.isInvalid)
    }

    @Test
    fun `post without csrf is 403`() {
        val (_, session) = admins.signedIn()
        val user = auth.user()
        val missing = mvc.post("/admin/users/$user/deactivate") { this.session = session }.andReturn().response
        assertEquals(403, missing.status)
        assertTrue(missing.contentAsString.contains(AdminDenied.CSRF_FAILED))
        val invalid =
            mvc
                .post("/admin/users/$user/deactivate") {
                    this.session = session
                    with(csrf().useInvalidToken())
                }.andReturn()
                .response
        assertEquals(403, invalid.status)
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM users WHERE id = ? AND deactivated_at IS NULL", Int::class.java, user))

        val anonymous = mvc.post("/admin/login") { param("email", "a@b.c") }.andReturn().response
        assertEquals(403, anonymous.status)
        val logout = mvc.post("/admin/logout") { this.session = session }.andReturn().response
        assertEquals(403, logout.status)
        assertEquals(200, page("/admin", session).response.status, "a refused logout leaves the session")
    }

    @Test
    fun `forms carry the csrf token`() {
        val login = mvc.get("/admin/login").andReturn()
        val html = login.response.contentAsString
        val token = Regex("name=\"_csrf\" value=\"([^\"]+)\"").find(html)?.groupValues?.get(1)
        assertTrue(token != null && token.isNotEmpty(), "login form has a _csrf field")
        val admin = admins.admin()
        val result =
            mvc
                .post("/admin/login") {
                    session = sessionOf(login)
                    param("_csrf", token)
                    param("email", admin.email)
                    param("password", admin.password)
                    with(
                        org.springframework.test.web.servlet.request.RequestPostProcessor {
                            it.apply { remoteAddr = admins.randomIp() }
                        },
                    )
                }.andReturn()
        assertRedirect(result.response, "/admin/login/totp")
    }

    @Test
    fun `logout ends the session and is audited`() {
        val (admin, session) = admins.signedIn(AdminRole.SUPPORT)
        val result = admins.post("/admin/logout", session, admins.randomIp())
        assertRedirect(result.response, "/admin/login")
        assertTrue(session.isInvalid)
        assertEquals(listOf("ADMIN_LOGIN_SUCCEEDED", "ADMIN_LOGGED_OUT"), admins.actions(admin.id))
        assertRedirect(page("/admin", MockHttpSession()).response, "/admin/login")
    }

    @Test
    fun `a disabled or changed account loses its open session`() {
        val (admin, session) = admins.signedIn()
        val (other, otherSession) = admins.signedIn(AdminRole.SUPPORT)
        assertEquals(200, page("/admin", session).response.status)
        accounts.findById(admin.id)!!.let {
            it.disabledAt = Instant.now()
            accounts.save(it)
        }
        assertRedirect(page("/admin", session).response, "/admin/login")
        assertTrue(session.isInvalid)

        accounts.findById(other.id)!!.let {
            it.role = AdminRole.ADMIN
            accounts.save(it)
        }
        assertRedirect(page("/admin", otherSession).response, "/admin/login")
    }

    @Test
    fun `the console session never opens the api and an api token never opens the console`() {
        val (_, session) = admins.signedIn()
        val api = mvc.get("/v1/me") { this.session = session }.andReturn().response
        assertEquals(401, api.status)
        val bearer = auth.bearer(auth.user())
        val console = mvc.get("/admin") { header(HttpHeaders.AUTHORIZATION, bearer) }.andReturn().response
        assertRedirect(console, "/admin/login")
        assertFalse(console.contentAsString.contains("Özet"))
    }
}
