package app.cetele.server.admin

import app.cetele.server.admin.totp.TotpCipher
import app.cetele.server.admin.totp.TotpService
import dev.samstevens.totp.code.DefaultCodeGenerator
import dev.samstevens.totp.code.HashingAlgorithm
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.mock.web.MockHttpSession
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.request.RequestPostProcessor
import java.security.SecureRandom
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals

/** A console account created for one test, with its password and TOTP secret in clear text. */
data class TestAdmin(
    val id: UUID,
    val email: String,
    val password: String,
    val secret: String?,
    val role: AdminRole,
)

/**
 * Console accounts and sign-ins for the admin tests. Every sign-in comes from its own random
 * client address, so the login rate limit of one test never touches another; every account is
 * fresh, so a TOTP step used by one test is never reused by another.
 */
class AdminTestSupport(
    private val mvc: MockMvc,
    private val accounts: AdminAccountRepository,
    private val passwords: AdminPasswords,
    private val cipher: TotpCipher,
    private val totp: TotpService,
    private val jdbc: JdbcTemplate,
) {
    private val generator = DefaultCodeGenerator(HashingAlgorithm.SHA1, 6)

    fun admin(
        role: AdminRole = AdminRole.ADMIN,
        enrolled: Boolean = true,
        mustChangePassword: Boolean = false,
    ): TestAdmin {
        val email = "admin-" + UUID.randomUUID().toString().take(12) + "@cetele.test"
        val password = "[ÖRNEK] parola " + UUID.randomUUID().toString().take(8)
        val account = AdminAccount(email, passwords.hash(password), role, null, Instant.now())
        account.mustChangePassword = mustChangePassword
        val secret = if (enrolled) totp.newSecret() else null
        if (secret != null) {
            account.totpSecretEnc = cipher.encrypt(secret)
            account.totpEnrolledAt = Instant.now()
        }
        accounts.save(account)
        return TestAdmin(account.id, email, password, secret, role)
    }

    /** The code of the current step, or of [offset] steps from it. */
    fun code(
        secret: String,
        offset: Long = 0,
    ): String = generator.generate(secret, totp.currentStep() + offset)

    fun randomIp(): String {
        val random = SecureRandom()
        return "10.${random.nextInt(256)}.${random.nextInt(256)}.${1 + random.nextInt(254)}"
    }

    /** POST with a CSRF token from [ip] in [session]; returns the result (the session may be a new one). */
    fun post(
        path: String,
        session: MockHttpSession,
        ip: String,
        vararg params: Pair<String, String>,
    ): MvcResult =
        mvc
            .post(path) {
                this.session = session
                with(csrf())
                with(RequestPostProcessor { request -> request.apply { remoteAddr = ip } })
                params.forEach { (name, value) -> param(name, value) }
            }.andReturn()

    /** Signs [admin] in completely and returns the authenticated session. */
    fun signIn(
        admin: TestAdmin,
        ip: String = randomIp(),
    ): MockHttpSession {
        val first = post("/admin/login", MockHttpSession(), ip, "email" to admin.email, "password" to admin.password)
        assertRedirect(first.response, "/admin/login/totp")
        val session = sessionOf(first)
        val second = post("/admin/login/totp", session, ip, "code" to code(checkNotNull(admin.secret)))
        assertRedirect(second.response, "/admin")
        return sessionOf(second)
    }

    /** A fresh signed-in account of [role]. */
    fun signedIn(role: AdminRole = AdminRole.ADMIN): Pair<TestAdmin, MockHttpSession> {
        val admin = admin(role)
        return admin to signIn(admin)
    }

    fun auditRows(actorId: UUID): List<Map<String, Any?>> =
        jdbc.queryForList(
            "SELECT action, actor_type, actor_id, target_type, target_id, ip_hash, trace_id, metadata::text AS metadata FROM audit_logs WHERE actor_id = ? ORDER BY at, id",
            actorId,
        )

    fun actions(actorId: UUID): List<String> = auditRows(actorId).map { it["action"] as String }

    companion object {
        fun sessionOf(result: MvcResult): MockHttpSession = result.request.getSession(false) as MockHttpSession

        fun assertRedirect(
            response: MockHttpServletResponse,
            location: String,
        ) {
            assertEquals(302, response.status, "expected a redirect to $location, body: ${response.contentAsString}")
            assertEquals(location, response.redirectedUrl)
        }
    }
}
