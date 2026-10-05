package app.cetele.server.db

import app.cetele.server.support.IntegrationTest
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

@IntegrationTest
class FlywayMigrationTest(
    @Autowired private val flyway: Flyway,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val tx: TransactionTemplate,
) {
    @Test
    fun `V1 is applied and nothing is pending`() {
        val info = flyway.info()
        assertEquals("1", info.current()?.version?.version)
        assertEquals(0, info.pending().size)
        val applied =
            jdbc.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE version = '1' AND success",
                Int::class.java,
            )
        assertEquals(1, applied)
    }

    @Test
    fun `V1 creates exactly the identity and tenancy tables`() {
        val tables =
            jdbc.queryForList(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'flyway_schema_history'
                ORDER BY table_name
                """.trimIndent(),
                String::class.java,
            )
        assertEquals(listOf("memberships", "shops", "users"), tables)
    }

    @Test
    fun `ids have no database default and the plan defaults to FREE`() {
        val idDefaults =
            jdbc.queryForList(
                """
                SELECT column_default FROM information_schema.columns
                WHERE table_schema = 'public' AND column_name = 'id' AND table_name IN ('users', 'shops', 'memberships')
                """.trimIndent(),
                String::class.java,
            )
        assertEquals(3, idDefaults.size)
        idDefaults.forEach { assertNull(it) }

        rolledBack {
            val owner = insertUser()
            val shop = insertShop(owner)
            val plan = jdbc.queryForObject("SELECT plan FROM shops WHERE id = ?", String::class.java, shop)
            assertEquals("FREE", plan)
        }
    }

    @Test
    fun `a user holds one membership per shop`() {
        rolledBack {
            val owner = insertUser()
            val shop = insertShop(owner)
            insertMembership(shop, owner, "OWNER")
            assertFailsWith<DataIntegrityViolationException> { insertMembership(shop, owner, "STAFF") }
        }
    }

    @Test
    fun `constraints reject unknown roles, plans and malformed phone numbers`() {
        rolledBack {
            val owner = insertUser()
            val shop = insertShop(owner)
            assertFailsWith<DataIntegrityViolationException> { insertMembership(shop, insertUser(), "ADMIN") }
        }
        rolledBack {
            val owner = insertUser()
            assertFailsWith<DataIntegrityViolationException> {
                jdbc.update(
                    "INSERT INTO shops (id, name, type, il, ilce, plan, created_by) VALUES (?, 'Bakkal', 'BAKKAL', 'İstanbul', 'Kadıköy', 'GOLD', ?)",
                    UUID.randomUUID(),
                    owner,
                )
            }
        }
        rolledBack {
            assertFailsWith<DataIntegrityViolationException> {
                jdbc.update("INSERT INTO users (id, phone_e164) VALUES (?, '05551234567')", UUID.randomUUID())
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

    private var phoneCounter = 0

    private fun insertUser(): UUID {
        val id = UUID.randomUUID()
        phoneCounter += 1
        val phone = "+90555" + (1_000_000 + phoneCounter).toString()
        jdbc.update("INSERT INTO users (id, phone_e164) VALUES (?, ?)", id, phone)
        return id
    }

    private fun insertShop(createdBy: UUID): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO shops (id, name, type, il, ilce, created_by) VALUES (?, 'Bakkal', 'BAKKAL', 'İstanbul', 'Kadıköy', ?)",
            id,
            createdBy,
        )
        return id
    }

    private fun insertMembership(
        shopId: UUID,
        userId: UUID,
        role: String,
    ) {
        jdbc.update("INSERT INTO memberships (id, shop_id, user_id, role) VALUES (?, ?, ?, ?)", UUID.randomUUID(), shopId, userId, role)
    }
}
