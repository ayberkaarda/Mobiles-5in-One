package app.cetele.server.admin

import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

@IntegrationTest
class V8AdminSchemaTest(
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val tx: TransactionTemplate,
) {
    private val argon = "\$argon2id\$v=19\$m=65536,t=3,p=1\$c2FsdA\$aGFzaA"

    @Test
    fun `V8 admin tables and indexes are present`() {
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version = '8' AND success", Int::class.java))
        listOf("admin_users", "audit_logs").forEach { table ->
            assertEquals(
                1,
                jdbc.queryForObject(
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?",
                    Int::class.java,
                    table,
                ),
            )
        }
        listOf("admin_users_email_key", "audit_logs_at_idx", "audit_logs_actor_idx", "audit_logs_target_idx").forEach { index ->
            assertEquals(
                1,
                jdbc.queryForObject(
                    "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?",
                    Int::class.java,
                    index,
                ),
            )
        }
        // No foreign key from audit_logs: a row outlives what it names.
        assertEquals(
            0,
            jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.table_constraints WHERE table_name = 'audit_logs' AND constraint_type = 'FOREIGN KEY'",
                Int::class.java,
            ),
        )
    }

    @Test
    fun `admin_users constraints`() {
        rejected { admin(email = "Buyuk@cetele.test") }
        rejected { admin(email = "adres-yok") }
        rejected { admin(role = "OWNER") }
        rejected { admin(hash = "\$2a\$10\$bcrypt") }
        rejected {
            jdbc.update(
                "INSERT INTO admin_users (id, email, password_hash, role, totp_enrolled_at) VALUES (?, ?, ?, 'ADMIN', now())",
                UUID.randomUUID(),
                email(),
                argon,
            )
        }
        rejected {
            jdbc.update(
                "INSERT INTO admin_users (id, email, password_hash, role, failed_attempts) VALUES (?, ?, ?, 'ADMIN', -1)",
                UUID.randomUUID(),
                email(),
                argon,
            )
        }
        rolledBack {
            val email = email()
            admin(email = email)
            assertFailsWith<DataIntegrityViolationException> { admin(email = email) }
        }
        rolledBack {
            val email = email()
            admin(email = email)
            val defaults =
                jdbc.queryForMap(
                    "SELECT must_change_password, failed_attempts, created_at IS NOT NULL AS created FROM admin_users WHERE email = ?",
                    email,
                )
            assertEquals(mapOf("must_change_password" to true, "failed_attempts" to 0, "created" to true), defaults)
        }
    }

    @Test
    fun `audit_logs constraints`() {
        val actor = UUID.randomUUID()
        rolledBack { audit("ADMIN", actor, "SHOP_VIEWED", "SHOP", UUID.randomUUID()) }
        rolledBack { audit("ADMIN", null, "ADMIN_LOGIN_FAILED") }
        rolledBack { audit("SYSTEM", null, "ADMIN_BOOTSTRAPPED", "ADMIN_USER", UUID.randomUUID()) }
        rejected { audit("ADMIN", null, "SHOP_VIEWED") }
        rejected { audit("ROBOT", actor, "SHOP_VIEWED") }
        rejected { audit("ADMIN", actor, "shop viewed") }
        rejected { audit("ADMIN", actor, "SHOP_VIEWED", "CUSTOMER", UUID.randomUUID()) }
        rejected { audit("ADMIN", actor, "SHOP_VIEWED", "SHOP", null) }
        rejected { audit("ADMIN", actor, "SHOP_VIEWED", ipHash = "ABC") }
        rejected { audit("ADMIN", actor, "SHOP_VIEWED", metadata = "[1, 2]") }
        rejected { audit("ADMIN", actor, "SHOP_VIEWED", metadata = """{"x": "${"a".repeat(2100)}"}""") }
    }

    private fun email() = "sema-" + UUID.randomUUID().toString().take(8) + "@cetele.test"

    private fun admin(
        email: String = email(),
        role: String = "SUPPORT",
        hash: String = argon,
    ) {
        jdbc.update("INSERT INTO admin_users (id, email, password_hash, role) VALUES (?, ?, ?, ?)", UUID.randomUUID(), email, hash, role)
    }

    private fun audit(
        actorType: String,
        actorId: UUID?,
        action: String,
        targetType: String? = null,
        targetId: UUID? = null,
        ipHash: String? = null,
        metadata: String = "{}",
    ) {
        jdbc.update(
            "INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id, ip_hash, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb)",
            UUID.randomUUID(),
            actorType,
            actorId,
            action,
            targetType,
            targetId,
            ipHash,
            metadata,
        )
    }

    private fun rejected(block: () -> Unit) {
        rolledBack { assertFailsWith<DataIntegrityViolationException> { block() } }
    }

    private fun rolledBack(block: () -> Unit) {
        tx.executeWithoutResult { status ->
            try {
                block()
            } finally {
                status.setRollbackOnly()
            }
        }
    }
}
