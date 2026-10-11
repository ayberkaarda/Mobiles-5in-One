package app.cetele.server.db

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestUsers
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

@IntegrationTest
class V9ReauthScopeSchemaTest(
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val tx: TransactionTemplate,
    @Autowired private val dataSource: DataSource,
) {
    @Test
    fun `V9 closes old open reauth codes and preserves login and consumed rows`() {
        val schema = "scope_" + UUID.randomUUID().toString().replace("-", "")
        try {
            migrate(schema, "8")
            val login = insert(schema, "LOGIN")
            val open = insert(schema, "REAUTH")
            val closed = insert(schema, "REAUTH")
            jdbc.update("UPDATE $schema.otp_codes SET consumed_at = '2026-01-01T00:00:00Z' WHERE id = ?", closed)
            val before = jdbc.queryForMap("SELECT consumed_at FROM $schema.otp_codes WHERE id = ?", closed)["consumed_at"]
            migrate(schema, "9")
            assertNull(jdbc.queryForMap("SELECT consumed_at, scope FROM $schema.otp_codes WHERE id = ?", login)["consumed_at"])
            assertNotNull(jdbc.queryForMap("SELECT consumed_at FROM $schema.otp_codes WHERE id = ?", open)["consumed_at"])
            assertEquals(before, jdbc.queryForMap("SELECT consumed_at FROM $schema.otp_codes WHERE id = ?", closed)["consumed_at"])
            assertNull(jdbc.queryForMap("SELECT scope FROM $schema.otp_codes WHERE id = ?", open)["scope"])
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS $schema CASCADE")
        }
    }

    @Test
    fun `scope is nullable restricted to reauth and limited to sixty four characters`() {
        tx.executeWithoutResult { status ->
            val login = insert("public", "LOGIN")
            val reauth = insert("public", "REAUTH")
            jdbc.update("UPDATE otp_codes SET scope = ? WHERE id = ?", "x".repeat(64), reauth)
            assertEquals("x".repeat(64), jdbc.queryForObject("SELECT scope FROM otp_codes WHERE id = ?", String::class.java, reauth))
            assertNull(jdbc.queryForMap("SELECT scope FROM otp_codes WHERE id = ?", login)["scope"])
            status.setRollbackOnly()
        }
        listOf("LOGIN" to "ACCOUNT_DELETE", "REAUTH" to "x".repeat(65)).forEach { (purpose, scope) ->
            assertFailsWith<DataIntegrityViolationException> {
                tx.executeWithoutResult {
                    val id = insert("public", purpose)
                    jdbc.update("UPDATE otp_codes SET scope = ? WHERE id = ?", scope, id)
                }
            }
        }
    }

    private fun migrate(
        schema: String,
        version: String,
    ) {
        Flyway
            .configure()
            .dataSource(dataSource)
            .schemas(schema)
            .defaultSchema(schema)
            .target(version)
            .load()
            .migrate()
    }

    private fun insert(
        schema: String,
        purpose: String,
    ): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO $schema.otp_codes (id, phone_e164, device_id, purpose, code_hmac, expires_at) " +
                "VALUES (?, ?, ?, ?, ?, now() + interval '5 minutes')",
            id,
            TestUsers.phone(),
            UUID.randomUUID(),
            purpose,
            ByteArray(32),
        )
        return id
    }
}
