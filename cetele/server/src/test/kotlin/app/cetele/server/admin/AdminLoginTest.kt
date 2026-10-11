package app.cetele.server.admin

import app.cetele.server.admin.AdminTestSupport.Companion.assertRedirect
import app.cetele.server.admin.AdminTestSupport.Companion.sessionOf
import app.cetele.server.admin.web.AdminLoginController
import app.cetele.server.security.CspNonceFilter
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.mock.web.MockHttpSession
import org.springframework.security.web.context.HttpSessionSecurityContextRepository
import java.time.Duration
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class AdminLoginTest : AdminIntegrationTest() {
    @Autowired lateinit var login: AdminLoginService

    @Test
    fun `password then totp grants the role`() {
        listOf(AdminRole.ADMIN, AdminRole.SUPPORT).forEach { role ->
            val admin = admins.admin(role)
            val ip = admins.randomIp()
            val first = admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to admin.password)
            assertRedirect(first.response, "/admin/login/totp")
            val pending = sessionOf(first)
            assertNull(
                pending.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY),
                "no role before the TOTP step",
            )
            assertRedirect(page("/admin", pending).response, "/admin/login")

            val second = admins.post("/admin/login/totp", pending, ip, "code" to admins.code(admin.secret!!))
            assertRedirect(second.response, "/admin")
            val session = sessionOf(second)
            assertEquals(200, page("/admin", session).response.status)
            assertEquals(listOf("ADMIN_LOGIN_SUCCEEDED"), admins.actions(admin.id))
            val account = accounts.findById(admin.id)!!
            assertNotNull(account.lastLoginAt)
            assertEquals(0, account.failedAttempts)
        }
    }

    @Test
    fun `totp code is single use`() {
        val admin = admins.admin()
        val ip = admins.randomIp()
        val code = admins.code(admin.secret!!)
        val first = admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to admin.password)
        assertRedirect(admins.post("/admin/login/totp", sessionOf(first), ip, "code" to code).response, "/admin")

        val again = admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to admin.password)
        val replay = admins.post("/admin/login/totp", sessionOf(again), ip, "code" to code)
        assertEquals(401, replay.response.status)
        assertTrue(replay.response.contentAsString.contains(AdminLoginController.CODE_FAILED))
        assertNull(sessionOf(replay).getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY))
        assertEquals(listOf("ADMIN_LOGIN_SUCCEEDED", "ADMIN_LOGIN_FAILED"), admins.actions(admin.id))
        assertEquals("""{"stage": "TOTP"}""", admins.auditRows(admin.id).last()["metadata"])
    }

    @Test
    fun `wrong and stale totp codes are refused`() {
        val admin = admins.admin()
        val ip = admins.randomIp()
        val first = admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to admin.password)
        val session = sessionOf(first)
        val stale = admins.code(admin.secret!!, offset = -2)
        val future = admins.code(admin.secret, offset = 2)
        val wrong = if (admins.code(admin.secret) == "000000") "111111" else "000000"
        listOf(stale, future, wrong, "abc12").forEach { code ->
            val result = admins.post("/admin/login/totp", session, ip, "code" to code)
            assertEquals(401, result.response.status, "code $code")
        }
        // Four failures leave the pre-authentication in place: the right code still completes the login.
        assertRedirect(admins.post("/admin/login/totp", session, ip, "code" to admins.code(admin.secret)).response, "/admin")
    }

    @Test
    fun `five failures lock for fifteen minutes`() {
        val admin = admins.admin()
        val ip = admins.randomIp()
        repeat(AdminLoginService.MAX_FAILURES) {
            val result = admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to "falsch-parola-123")
            assertEquals(401, result.response.status)
        }
        val account = accounts.findById(admin.id)!!
        val until = assertNotNull(account.lockedUntil)
        val lockout = Duration.between(Instant.now(), until)
        assertTrue(lockout > Duration.ofMinutes(14) && lockout <= Duration.ofMinutes(15), "lockout $lockout")
        assertEquals(0, account.failedAttempts)

        // The right password while locked fails exactly like a wrong one.
        val locked = admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to admin.password)
        assertEquals(401, locked.response.status)
        assertTrue(locked.response.contentAsString.contains(AdminLoginController.LOGIN_FAILED))
        val actions = admins.actions(admin.id)
        // The fifth failure and the lockout are written in one transaction; compare without their order.
        assertEquals((List(6) { "ADMIN_LOGIN_FAILED" } + "ADMIN_LOCKED_OUT").sorted(), actions.sorted())
        val rows = admins.auditRows(admin.id)
        assertEquals("""{"stage": "LOCKED"}""", rows.last()["metadata"])
        assertEquals("ADMIN_USER", rows.first { it["action"] == "ADMIN_LOCKED_OUT" }["target_type"])
    }

    @Test
    fun `password and totp failures count together`() {
        val admin = admins.admin()
        val ip = admins.randomIp()
        repeat(3) { admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to "falsch-parola-123") }
        val first = admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to admin.password)
        val session = sessionOf(first)
        val secret = admin.secret!!
        assertEquals(
            401,
            admins.post("/admin/login/totp", session, ip, "code" to "999999".takeIf { it != admins.code(secret) }!!).response.status,
        )
        val fifth = admins.post("/admin/login/totp", session, ip, "code" to "888888".takeIf { it != admins.code(secret) }!!)
        // The fifth failure locks the account and drops the pre-authentication.
        assertEquals(401, fifth.response.status)
        assertTrue(fifth.response.contentAsString.contains(AdminLoginController.LOGIN_FAILED))
        assertNotNull(accounts.findById(admin.id)!!.lockedUntil)
        assertRedirect(page("/admin/login/totp", sessionOf(fifth)).response, "/admin/login")
    }

    @Test
    fun `unknown email and wrong password look the same`() {
        val admin = admins.admin()
        val ip = admins.randomIp()
        val unknown = admins.post("/admin/login", MockHttpSession(), ip, "email" to "kimse-" + admin.email, "password" to admin.password)
        val wrong = admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to "falsch-parola-123")
        assertEquals(unknown.response.status, wrong.response.status)
        assertEquals(normalise(unknown.response.contentAsString, unknown), normalise(wrong.response.contentAsString, wrong))
        val unknownRow =
            jdbc.queryForMap(
                "SELECT actor_id, metadata::text AS metadata FROM audit_logs WHERE action = 'ADMIN_LOGIN_FAILED' AND trace_id = ?::uuid",
                unknown.response.getHeader("X-Trace-Id"),
            )
        assertNull(unknownRow["actor_id"])
        assertEquals("""{"stage": "PASSWORD"}""", unknownRow["metadata"])
        assertEquals(listOf("ADMIN_LOGIN_FAILED"), admins.actions(admin.id))
    }

    @Test
    fun `disabled accounts fail like a wrong password`() {
        val admin = admins.admin()
        accounts.findById(admin.id)!!.let {
            it.disabledAt = Instant.now()
            accounts.save(it)
        }
        val result = admins.post("/admin/login", MockHttpSession(), admins.randomIp(), "email" to admin.email, "password" to admin.password)
        assertEquals(401, result.response.status)
        assertTrue(result.response.contentAsString.contains(AdminLoginController.LOGIN_FAILED))
    }

    @Test
    fun `forced enrollment and password change come before any page`() {
        val admin = admins.admin(enrolled = false, mustChangePassword = true)
        val ip = admins.randomIp()
        val first = admins.post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to admin.password)
        assertRedirect(first.response, "/admin/totp/enroll")
        val session = sessionOf(first)
        listOf("/admin", "/admin/shops", "/admin/users").forEach { assertRedirect(page(it, session).response, "/admin/login") }
        assertRedirect(page("/admin/account/password", session).response, "/admin/login")

        val enrollPage = page("/admin/totp/enroll", session)
        assertEquals(200, enrollPage.response.status)
        val html = enrollPage.response.contentAsString
        assertTrue(html.contains("data:image/png;base64,"))
        val secret = Regex("secret=([A-Z2-7]{32})").find(html)!!.groupValues[1]
        assertTrue(html.contains("otpauth://totp/"))
        assertNull(accounts.findById(admin.id)!!.totpSecretEnc, "the secret is stored only after a code verifies")

        assertEquals(
            401,
            admins.post("/admin/totp/enroll", session, ip, "code" to "000000".takeIf { it != admins.code(secret) }!!).response.status,
        )
        val enrolled = admins.post("/admin/totp/enroll", session, ip, "code" to admins.code(secret))
        assertRedirect(enrolled.response, "/admin/account/password")
        val afterEnroll = sessionOf(enrolled)
        assertRedirect(page("/admin", afterEnroll).response, "/admin/login")
        assertNotNull(accounts.findById(admin.id)!!.totpEnrolledAt)

        val short = admins.post("/admin/account/password", afterEnroll, ip, "newPassword" to "kisa", "confirmPassword" to "kisa")
        assertEquals(400, short.response.status)
        val same =
            admins.post("/admin/account/password", afterEnroll, ip, "newPassword" to admin.password, "confirmPassword" to admin.password)
        assertEquals(400, same.response.status)
        val newPassword = "[ÖRNEK] yeni uzun parola"
        val changed =
            admins.post(
                "/admin/account/password",
                afterEnroll,
                ip,
                "newPassword" to newPassword,
                "confirmPassword" to newPassword,
            )
        assertRedirect(changed.response, "/admin")
        assertEquals(200, page("/admin", sessionOf(changed)).response.status)
        val account = accounts.findById(admin.id)!!
        assertFalse(account.mustChangePassword)
        assertTrue(account.passwordHash.startsWith("\$argon2id\$"))
        assertTrue(passwords.matches(newPassword, account.passwordHash))
        assertEquals(
            listOf("ADMIN_LOGIN_FAILED", "ADMIN_TOTP_ENROLLED", "ADMIN_PASSWORD_CHANGED", "ADMIN_LOGIN_SUCCEEDED"),
            admins.actions(admin.id),
        )
    }

    @Test
    fun `login attempts are rate limited per client address`() {
        val ip = admins.randomIp()
        repeat(20) {
            val result = admins.post("/admin/login", MockHttpSession(), ip, "email" to "yok@cetele.test", "password" to "falsch-parola-123")
            assertEquals(401, result.response.status)
        }
        val limited = admins.post("/admin/login", MockHttpSession(), ip, "email" to "yok@cetele.test", "password" to "falsch-parola-123")
        assertEquals(429, limited.response.status)
        assertNotNull(limited.response.getHeader("Retry-After"))
        assertTrue(limited.response.contentType!!.startsWith("text/html"))
        assertEquals(
            401,
            admins
                .post(
                    "/admin/login",
                    MockHttpSession(),
                    admins.randomIp(),
                    "email" to "yok@cetele.test",
                    "password" to "x",
                ).response.status,
        )
    }

    @Test
    fun `steps cannot be skipped or entered without a password`() {
        val fresh = MockHttpSession()
        assertRedirect(page("/admin/login/totp", fresh).response, "/admin/login")
        assertRedirect(page("/admin/totp/enroll", fresh).response, "/admin/login")
        assertRedirect(admins.post("/admin/login/totp", fresh, admins.randomIp(), "code" to "123456").response, "/admin/login")
        assertRedirect(
            admins.post("/admin/account/password", fresh, admins.randomIp(), "newPassword" to "x".repeat(20)).response,
            "/admin/login",
        )
        // An enrolled admin cannot jump to enrollment to replace the authenticator.
        val admin = admins.admin()
        val first = admins.post("/admin/login", MockHttpSession(), admins.randomIp(), "email" to admin.email, "password" to admin.password)
        assertRedirect(page("/admin/totp/enroll", sessionOf(first)).response, "/admin/login")
    }

    private fun normalise(
        html: String,
        result: org.springframework.test.web.servlet.MvcResult,
    ): String {
        val nonce = result.request.getAttribute(CspNonceFilter.ATTRIBUTE) as String
        return html.replace(nonce, "NONCE").replace(Regex("name=\"_csrf\" value=\"[^\"]+\""), "name=\"_csrf\" value=\"TOKEN\"")
    }

    @Test
    fun `reset replaces the old password and requires enrollment then password change`() {
        val (_, operator) = admins.signedIn()
        val (target, oldSession) = admins.signedIn()
        val reset = admins.post("/admin/admins/${target.id}/totp-reset", operator, admins.randomIp())
        assertEquals(200, reset.response.status)
        assertEquals("admin/admin-reset", reset.modelAndView!!.viewName)
        assertTrue(reset.response.getHeader("Cache-Control")!!.contains("no-store"))
        val created = reset.modelAndView!!.model["created"] as CreatedAdmin
        assertTrue(reset.response.contentAsString.contains(created.oneTimePassword))
        val account = accounts.findById(target.id)!!
        assertNull(account.totpSecretEnc)
        assertNull(account.totpEnrolledAt)
        assertNull(account.totpLastStep)
        assertTrue(account.mustChangePassword)
        assertFalse(passwords.matches(target.password, account.passwordHash))
        assertTrue(passwords.matches(created.oneTimePassword, account.passwordHash))
        val ip = admins.randomIp()
        val refused =
            admins.post(
                "/admin/login",
                MockHttpSession(),
                ip,
                "email" to target.email,
                "password" to target.password,
            )
        assertEquals(401, refused.response.status)
        val first =
            admins.post(
                "/admin/login",
                MockHttpSession(),
                ip,
                "email" to target.email,
                "password" to created.oneTimePassword,
            )
        assertRedirect(first.response, "/admin/totp/enroll")
        val pending = sessionOf(first)
        assertEquals(200, page("/admin/totp/enroll", pending).response.status)
        val state = pending.getAttribute(AdminSessionPolicy.PENDING) as app.cetele.server.admin.web.PendingLogin
        val enrolled = admins.post("/admin/totp/enroll", pending, ip, "code" to admins.code(checkNotNull(state.enrollSecret)))
        assertRedirect(enrolled.response, "/admin/account/password")
        assertRedirect(page("/admin", sessionOf(enrolled)).response, "/admin/login")
        val replacement = "[ÖRNEK] yeni güvenli parola"
        val finished =
            admins.post(
                "/admin/account/password",
                sessionOf(enrolled),
                ip,
                "newPassword" to replacement,
                "confirmPassword" to replacement,
            )
        assertRedirect(finished.response, "/admin")
        assertEquals(200, page("/admin", sessionOf(finished)).response.status)
        assertRedirect(page("/admin", oldSession).response, "/admin/login")
        assertTrue(oldSession.isInvalid)
        assertFalse(accounts.findById(target.id)!!.mustChangePassword)
        assertFalse(passwords.matches(created.oneTimePassword, accounts.findById(target.id)!!.passwordHash))
        assertFalse(page("/admin/admins", operator).response.contentAsString.contains(created.oneTimePassword))
    }

    @Test
    fun `five wrong current passwords lock the account and end the session`() {
        val (admin, session) = admins.signedIn()
        val replacement = "[ÖRNEK] değiştirilmiş parola"
        repeat(AdminLoginService.MAX_FAILURES - 1) { index ->
            val refused =
                admins.post(
                    "/admin/account/password",
                    session,
                    admins.randomIp(),
                    "currentPassword" to "yanlis-parola",
                    "newPassword" to replacement,
                    "confirmPassword" to replacement,
                )
            assertEquals(400, refused.response.status)
            assertTrue(refused.response.contentAsString.contains(AdminLoginService.WRONG_CURRENT))
            assertEquals(index + 1, accounts.findById(admin.id)!!.failedAttempts)
            assertEquals(200, page("/admin", session).response.status)
        }
        val fifth =
            admins.post(
                "/admin/account/password",
                session,
                admins.randomIp(),
                "currentPassword" to "yanlis-parola",
                "newPassword" to replacement,
                "confirmPassword" to replacement,
            )
        assertRedirect(fifth.response, "/admin/login")
        assertTrue(session.isInvalid)
        val until = assertNotNull(accounts.findById(admin.id)!!.lockedUntil)
        assertTrue(Duration.between(Instant.now(), until) > Duration.ofMinutes(14))
        assertEquals(PasswordChangeResult.Restart, login.changePassword(admin.id, admin.password, replacement))
        val locked =
            admins.post(
                "/admin/login",
                MockHttpSession(),
                admins.randomIp(),
                "email" to admin.email,
                "password" to admin.password,
            )
        assertEquals(401, locked.response.status)
        assertEquals(5, admins.auditRows(admin.id).count { it["metadata"] == """{"stage": "PASSWORD"}""" })
        assertEquals(1, admins.actions(admin.id).count { it == "ADMIN_LOCKED_OUT" })
        assertTrue(passwords.matches(admin.password, accounts.findById(admin.id)!!.passwordHash))
    }

    @Test
    fun `correct current password changes the password and clears failures`() {
        val (admin, session) = admins.signedIn()
        val replacement = "[ÖRNEK] güvenli yeni parola"
        val wrong =
            admins.post(
                "/admin/account/password",
                session,
                admins.randomIp(),
                "currentPassword" to "yanlis",
                "newPassword" to replacement,
                "confirmPassword" to replacement,
            )
        assertEquals(400, wrong.response.status)
        val changed =
            admins.post(
                "/admin/account/password",
                session,
                admins.randomIp(),
                "currentPassword" to admin.password,
                "newPassword" to replacement,
                "confirmPassword" to replacement,
            )
        assertRedirect(changed.response, "/admin")
        assertEquals(0, accounts.findById(admin.id)!!.failedAttempts)
        assertTrue(passwords.matches(replacement, accounts.findById(admin.id)!!.passwordHash))
    }

    @Test
    fun `password change failures share the sign in failure counter`() {
        val (admin, session) = admins.signedIn()
        repeat(3) {
            val rejected =
                admins.post(
                    "/admin/login",
                    MockHttpSession(),
                    admins.randomIp(),
                    "email" to admin.email,
                    "password" to "yanlis-parola",
                )
            assertEquals(401, rejected.response.status)
        }
        assertEquals(3, accounts.findById(admin.id)!!.failedAttempts)
        val replacement = "[ÖRNEK] ortak sayaç parolası"
        repeat(2) { index ->
            val rejected =
                admins.post(
                    "/admin/account/password",
                    session,
                    admins.randomIp(),
                    "currentPassword" to "yanlis-parola",
                    "newPassword" to replacement,
                    "confirmPassword" to replacement,
                )
            if (index == 0) {
                assertEquals(400, rejected.response.status)
                assertEquals(4, accounts.findById(admin.id)!!.failedAttempts)
            } else {
                assertRedirect(rejected.response, "/admin/login")
            }
        }
        assertTrue(session.isInvalid)
        assertNotNull(accounts.findById(admin.id)!!.lockedUntil)
        assertEquals(1, admins.actions(admin.id).count { it == "ADMIN_LOCKED_OUT" })
    }

    @Test
    fun `stale pending credentials cannot pass the locked row check`() {
        val (admin, session) = admins.signedIn()
        val pending = login.passwordStep(admin.email, admin.password) as LoginStepResult.Accepted
        val replacement = "[ÖRNEK] yarım girişi kapatan parola"
        val changed =
            admins.post(
                "/admin/account/password",
                session,
                admins.randomIp(),
                "currentPassword" to admin.password,
                "newPassword" to replacement,
                "confirmPassword" to replacement,
            )
        assertRedirect(changed.response, "/admin")
        assertEquals(
            LoginStepResult.Rejected(restart = true),
            login.totpStep(admin.id, admins.code(admin.secret!!, offset = 1), checkNotNull(pending.startedAt)),
        )
        assertEquals(200, page("/admin", session).response.status)
    }
}
