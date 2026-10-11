package app.cetele.server.admin

import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class AdminBootstrapTest : AdminIntegrationTest() {
    @Autowired lateinit var bootstrap: AdminBootstrapService

    @Autowired lateinit var tx: TransactionTemplate

    private val password = "[ÖRNEK] ilk yönetici parolası"

    /** Runs [block] with every enabled ADMIN disabled, then rolls everything back. */
    private fun withoutAdmins(block: () -> Unit) {
        tx.executeWithoutResult { status ->
            try {
                jdbc.update("UPDATE admin_users SET disabled_at = now() WHERE role = 'ADMIN' AND disabled_at IS NULL")
                block()
            } finally {
                status.setRollbackOnly()
            }
        }
    }

    @Test
    fun `creates the first admin once, forced to change the password and to enroll`() {
        val email = "Kurucu-" + UUID.randomUUID().toString().take(8) + "@Cetele.Test"
        withoutAdmins {
            assertTrue(bootstrap.bootstrap(email, password))
            val account = accounts.findByEmail(email.lowercase())!!
            assertEquals(AdminRole.ADMIN, account.role)
            assertTrue(account.mustChangePassword)
            assertNull(account.totpSecretEnc)
            assertTrue(account.passwordHash.startsWith("\$argon2id\$"))
            assertTrue(passwords.matches(password, account.passwordHash))
            val row =
                jdbc.queryForMap(
                    "SELECT actor_type, actor_id, target_type, target_id, ip_hash, metadata::text AS metadata FROM audit_logs WHERE action = 'ADMIN_BOOTSTRAPPED' AND target_id = ?",
                    account.id,
                )
            assertEquals("SYSTEM", row["actor_type"])
            assertNull(row["actor_id"])
            assertEquals("ADMIN_USER", row["target_type"])
            assertNull(row["ip_hash"])
            assertEquals("""{"role": "ADMIN"}""", row["metadata"])

            // Now an enabled ADMIN exists: the variables are ignored.
            assertFalse(bootstrap.bootstrap("ikinci-" + email, password))
        }
    }

    @Test
    fun `is ignored while an enabled admin exists or a variable is missing`() {
        admins.admin(AdminRole.ADMIN)
        val email = "bos-" + UUID.randomUUID().toString().take(8) + "@cetele.test"
        assertFalse(bootstrap.bootstrap(email, password))
        assertNull(accounts.findByEmail(email))
        withoutAdmins {
            assertFalse(bootstrap.bootstrap("", password))
            assertFalse(bootstrap.bootstrap(email, ""))
            assertNull(accounts.findByEmail(email))
        }
    }

    @Test
    fun `recovers a disabled account with the same email`() {
        val lost = admins.admin(AdminRole.ADMIN)
        withoutAdmins {
            assertTrue(bootstrap.bootstrap(lost.email, password))
            val account = accounts.findById(lost.id)!!
            assertTrue(account.enabled)
            assertNull(account.totpSecretEnc)
            assertNull(account.totpEnrolledAt)
            assertTrue(account.mustChangePassword)
            assertTrue(passwords.matches(password, account.passwordHash))
        }
    }

    @Test
    fun `refuses malformed bootstrap values`() {
        withoutAdmins {
            assertFailsWith<IllegalStateException> { bootstrap.bootstrap("kimlik-yok", password) }
            assertFailsWith<IllegalStateException> { bootstrap.bootstrap("kisa@cetele.test", "kisa") }
        }
    }

    @Test
    fun `the startup runner passes the configured variables`() {
        val email = "baslangic-" + UUID.randomUUID().toString().take(8) + "@cetele.test"
        withoutAdmins {
            AdminBootstrapRunner(AdminProperties(bootstrapEmail = email, bootstrapPassword = password), bootstrap).run(
                org.springframework.boot.DefaultApplicationArguments(),
            )
            assertEquals(AdminRole.ADMIN, accounts.findByEmail(email)!!.role)
        }
        assertNull(accounts.findByEmail(email), "rolled back")
    }
}
