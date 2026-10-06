package app.cetele.server.db

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class V2AuthSchemaTest(
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val tx: TransactionTemplate,
    @Autowired private val auth: TestAuth,
) {
    @Test
    fun `V2 creates the sign-in tables with app-side ids and timestamptz columns`() {
        val tables =
            jdbc.queryForList(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('otp_codes', 'refresh_tokens', 'devices')",
                String::class.java,
            )
        assertEquals(setOf("otp_codes", "refresh_tokens", "devices"), tables.toSet())
        jdbc
            .queryForList(
                "SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id' AND table_name IN ('otp_codes', 'refresh_tokens', 'devices')",
                String::class.java,
            ).forEach { assertNull(it) }
        val timeTypes =
            jdbc.queryForList(
                "SELECT DISTINCT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('otp_codes', 'refresh_tokens', 'devices') AND column_name LIKE '%\\_at' ESCAPE '\\'",
                String::class.java,
            )
        assertEquals(listOf("timestamp with time zone"), timeTypes)
        val index =
            jdbc.queryForObject(
                "SELECT indexdef FROM pg_indexes WHERE tablename = 'otp_codes' AND indexname = 'otp_codes_phone_created_idx'",
                String::class.java,
            )
        assertTrue(index!!.contains("(phone_e164, created_at)"))
    }

    @Test
    fun `otp codes default to LOGIN and reject unknown purposes and malformed hashes`() {
        rolledBack {
            val id = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO otp_codes (id, phone_e164, device_id, code_hmac, expires_at) VALUES (?, ?, ?, ?, now())",
                id,
                TestUsers.phone(),
                UUID.randomUUID(),
                ByteArray(32),
            )
            assertEquals("LOGIN", jdbc.queryForObject("SELECT purpose FROM otp_codes WHERE id = ?", String::class.java, id))
            assertEquals(0, jdbc.queryForObject("SELECT attempts FROM otp_codes WHERE id = ?", Int::class.java, id))
        }
        rolledBack {
            assertFailsWith<DataIntegrityViolationException> {
                jdbc.update(
                    "INSERT INTO otp_codes (id, phone_e164, device_id, purpose, code_hmac, expires_at) VALUES (?, ?, ?, 'SIGNUP', ?, now())",
                    UUID.randomUUID(),
                    TestUsers.phone(),
                    UUID.randomUUID(),
                    ByteArray(32),
                )
            }
        }
        rolledBack {
            assertFailsWith<DataIntegrityViolationException> {
                jdbc.update(
                    "INSERT INTO otp_codes (id, phone_e164, device_id, code_hmac, expires_at) VALUES (?, ?, ?, ?, now())",
                    UUID.randomUUID(),
                    TestUsers.phone(),
                    UUID.randomUUID(),
                    "123456".toByteArray(),
                )
            }
        }
    }

    @Test
    fun `refresh token hashes are unique and devices are unique per user`() {
        rolledBack {
            val user = auth.user()
            val hash = ByteArray(32) { 1 }
            insertRefresh(user, hash)
            assertFailsWith<DataIntegrityViolationException> { insertRefresh(user, hash) }
        }
        rolledBack {
            val user = auth.user()
            val device = UUID.randomUUID()
            insertDevice(user, device)
            assertFailsWith<DataIntegrityViolationException> { insertDevice(user, device) }
        }
        rolledBack {
            insertDevice(auth.user(), UUID.randomUUID())
            assertFailsWith<DataIntegrityViolationException> { insertDevice(UUID.randomUUID(), UUID.randomUUID()) }
        }
    }

    private fun insertRefresh(
        user: UUID,
        hash: ByteArray,
    ) {
        jdbc.update(
            "INSERT INTO refresh_tokens (id, token_hash, user_id, device_id, family_id, expires_at) VALUES (?, ?, ?, ?, ?, now())",
            UUID.randomUUID(),
            hash,
            user,
            UUID.randomUUID(),
            UUID.randomUUID(),
        )
    }

    private fun insertDevice(
        user: UUID,
        device: UUID,
    ) {
        jdbc.update(
            "INSERT INTO devices (id, user_id, device_id, model, app_version, last_seen_at) VALUES (?, ?, ?, 'Pixel 8', '1.0.0', now())",
            UUID.randomUUID(),
            user,
            device,
        )
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
