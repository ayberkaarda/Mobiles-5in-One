package app.cetele.server.db

import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestUsers
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** V3: shop types, creation timestamps, the one-owner index and the invitations table. */
@IntegrationTest
class V3TenancyMigrationTest(
    @Autowired private val flyway: Flyway,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val tx: TransactionTemplate,
) {
    @Test
    fun `V3 is applied`() {
        val applied =
            jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version = '3' AND success", Int::class.java)
        assertEquals(1, applied)
        assertEquals(0, flyway.info().pending().size)
    }

    @Test
    fun `invitations has the contract columns and ids have no database default`() {
        val columns =
            jdbc.queryForList(
                """
                SELECT column_name || ':' || data_type || ':' || is_nullable FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'invitations' ORDER BY ordinal_position
                """.trimIndent(),
                String::class.java,
            )
        assertEquals(
            listOf(
                "id:uuid:NO",
                "shop_id:uuid:NO",
                "phone_e164:text:NO",
                "code_hash:text:NO",
                "expires_at:timestamp with time zone:NO",
                "accepted_at:timestamp with time zone:YES",
                "created_by:uuid:NO",
                "created_at:timestamp with time zone:NO",
            ),
            columns,
        )
        val idDefault =
            jdbc.queryForList(
                "SELECT column_default FROM information_schema.columns WHERE table_name = 'invitations' AND column_name = 'id'",
                String::class.java,
            )
        assertEquals(listOf<String?>(null), idDefault)
    }

    @Test
    fun `shops and memberships get created_at and the one-owner index exists`() {
        rolledBack {
            val owner = insertUser()
            val shop = insertShop(owner, "BAKKAL")
            insertMembership(shop, owner, "OWNER")
            assertNotNull(jdbc.queryForObject("SELECT created_at FROM shops WHERE id = ?", java.sql.Timestamp::class.java, shop))
            assertNotNull(
                jdbc.queryForObject("SELECT created_at FROM memberships WHERE shop_id = ?", java.sql.Timestamp::class.java, shop),
            )
        }
        val index =
            jdbc.queryForObject(
                "SELECT indexdef FROM pg_indexes WHERE tablename = 'memberships' AND indexname = 'memberships_one_owner'",
                String::class.java,
            )
        assertTrue(index!!.contains("UNIQUE") && index.contains("WHERE (role = 'OWNER'::text)"), index)
    }

    @Test
    fun `shop types are restricted to the six kinds`() {
        listOf("BAKKAL", "MANAV", "KASAP", "BERBER", "KAHVEHANE", "DIGER").forEach { type ->
            rolledBack { insertShop(insertUser(), type) }
        }
        listOf("MARKET", "bakkal", "").forEach { type ->
            rolledBack { assertFailsWith<DataIntegrityViolationException> { insertShop(insertUser(), type) } }
        }
    }

    @Test
    fun `invitation constraints reject malformed hashes, phones, expiry and duplicate codes`() {
        val hash = "a".repeat(64)
        rolledBack {
            val owner = insertUser()
            val shop = insertShop(owner, "BAKKAL")
            insertInvitation(shop, owner, hash, "+905551234567", "now() + interval '1 day'")
            assertFailsWith<DataIntegrityViolationException> {
                insertInvitation(shop, owner, hash, "+905551234567", "now() + interval '1 day'")
            }
        }
        val rejected =
            listOf(
                Triple("A".repeat(64), "+905551234567", "now() + interval '1 day'"),
                Triple("abc", "+905551234567", "now() + interval '1 day'"),
                Triple(hash, "05551234567", "now() + interval '1 day'"),
                Triple(hash, "+905551234567", "now() - interval '1 day'"),
            )
        rejected.forEach { (codeHash, phone, expiry) ->
            rolledBack {
                val owner = insertUser()
                val shop = insertShop(owner, "BAKKAL")
                assertFailsWith<DataIntegrityViolationException>("$codeHash $phone $expiry") {
                    insertInvitation(shop, owner, codeHash, phone, expiry)
                }
            }
        }
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

    private fun insertUser(): UUID {
        val id = TraceIdFilter.uuidV7()
        jdbc.update("INSERT INTO users (id, phone_e164) VALUES (?, ?)", id, TestUsers.phone())
        return id
    }

    private fun insertShop(
        createdBy: UUID,
        type: String,
    ): UUID {
        val id = TraceIdFilter.uuidV7()
        jdbc.update(
            "INSERT INTO shops (id, name, type, il, ilce, created_by) VALUES (?, 'Bakkal', ?, 'İstanbul', 'Kadıköy', ?)",
            id,
            type,
            createdBy,
        )
        return id
    }

    private fun insertMembership(
        shopId: UUID,
        userId: UUID,
        role: String,
    ) {
        jdbc.update(
            "INSERT INTO memberships (id, shop_id, user_id, role) VALUES (?, ?, ?, ?)",
            TraceIdFilter.uuidV7(),
            shopId,
            userId,
            role,
        )
    }

    private fun insertInvitation(
        shopId: UUID,
        createdBy: UUID,
        codeHash: String,
        phone: String,
        expiresAtSql: String,
    ) {
        jdbc.update(
            "INSERT INTO invitations (id, shop_id, phone_e164, code_hash, expires_at, created_by) VALUES (?, ?, ?, ?, $expiresAtSql, ?)",
            TraceIdFilter.uuidV7(),
            shopId,
            phone,
            codeHash,
            createdBy,
        )
    }
}
