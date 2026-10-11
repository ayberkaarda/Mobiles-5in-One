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

    @Test
    fun `password change rotates its session and ends other sessions and pending logins`() {
        val (admin, first) = admins.signedIn()
        val ip = admins.randomIp()
        val password =
            admins.post(
                "/admin/login",
                MockHttpSession(),
                ip,
                "email" to admin.email,
                "password" to admin.password,
            )
        val secondLogin =
            admins.post(
                "/admin/login/totp",
                sessionOf(password),
                ip,
                "code" to admins.code(admin.secret!!, offset = 1),
            )
        assertRedirect(secondLogin.response, "/admin")
        val second = sessionOf(secondLogin)
        val pendingLogin =
            admins.post(
                "/admin/login",
                MockHttpSession(),
                admins.randomIp(),
                "email" to admin.email,
                "password" to admin.password,
            )
        val pending = sessionOf(pendingLogin)
        val initialId = first.id
        val replacement = "[ÖRNEK] oturum yenileyen parola"
        val changed =
            admins.post(
                "/admin/account/password",
                first,
                admins.randomIp(),
                "currentPassword" to admin.password,
                "newPassword" to replacement,
                "confirmPassword" to replacement,
            )
        assertRedirect(changed.response, "/admin")
        assertNotEquals(initialId, first.id)
        assertEquals(200, page("/admin", first).response.status)
        assertRedirect(page("/admin", second).response, "/admin/login")
        assertTrue(second.isInvalid)
        assertRedirect(page("/admin/login/totp", pending).response, "/admin/login")
        assertTrue(pending.isInvalid)
    }

    @Test
    fun `totp reset ends authenticated and pending sessions while the operator stays signed in`() {
        val (_, operator) = admins.signedIn()
        val (target, session) = admins.signedIn()
        val first =
            admins.post(
                "/admin/login",
                MockHttpSession(),
                admins.randomIp(),
                "email" to target.email,
                "password" to target.password,
            )
        val pending = sessionOf(first)
        assertEquals(200, admins.post("/admin/admins/${target.id}/totp-reset", operator, admins.randomIp()).response.status)
        assertRedirect(page("/admin", session).response, "/admin/login")
        assertTrue(session.isInvalid)
        assertRedirect(page("/admin/login/totp", pending).response, "/admin/login")
        assertTrue(pending.isInvalid)
        assertEquals(200, page("/admin", operator).response.status)
    }

    @Test
    fun `a newer enrollment ends an old session and equal stored timestamps remain current`() {
        val (admin, session) = admins.signedIn()
        val context =
            session.getAttribute(
                org.springframework.security.web.context.HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
            ) as org.springframework.security.core.context.SecurityContext
        val principal = checkNotNull(AdminPrincipal.of(context.authentication))
        jdbc.update(
            "UPDATE admin_users SET password_changed_at = ?, totp_enrolled_at = ? WHERE id = ?",
            java.sql.Timestamp.from(principal.authenticatedAt),
            java.sql.Timestamp.from(principal.authenticatedAt),
            admin.id,
        )
        assertEquals(200, page("/admin", session).response.status)
        jdbc.update(
            "UPDATE admin_users SET totp_enrolled_at = ? WHERE id = ?",
            java.sql.Timestamp.from(principal.authenticatedAt.plusSeconds(1)),
            admin.id,
        )
        assertRedirect(page("/admin", session).response, "/admin/login")
        assertTrue(session.isInvalid)
    }
}
