package app.cetele.server.billing

import app.cetele.server.support.IntegrationTest
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

@IntegrationTest
class V6BillingSchemaTest(
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val tx: TransactionTemplate,
) {
    private fun rollback(block: () -> Unit) =
        tx.executeWithoutResult { status ->
            try {
                block()
            } finally {
                status.setRollbackOnly()
            }
        }

    private fun rejected(block: () -> Unit) = rollback { assertFailsWith<DataIntegrityViolationException> { block() } }

    private fun user(): UUID =
        UUID.randomUUID().also { jdbc.update("INSERT INTO users (id, phone_e164) VALUES (?, ?)", it, TestUsers.phone()) }

    private fun shop(): UUID {
        val id = UUID.randomUUID()
        jdbc.update("INSERT INTO shops (id, name, type, il, ilce) VALUES (?, 'Shop', 'BAKKAL', 'City', 'District')", id)
        return id
    }

    private fun hash(): String = PurchaseTokens.hash(UUID.randomUUID().toString())

    private fun subscription(
        shop: UUID?,
        state: String = "ACTIVE",
        hash: String = hash(),
        superseded: Boolean = false,
        revoked: Boolean = false,
        linkedBy: UUID? = null,
        product: String = "cetele_pro",
    ): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO subscriptions (id, shop_id, purchase_token_hash, product_id, state, linked_by, linked_at, last_verified_at, " +
                "superseded_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, now(), now(), CASE WHEN ? THEN now() END, CASE WHEN ? THEN now() END)",
            id,
            shop,
            hash,
            product,
            state,
            linkedBy,
            superseded,
            revoked,
        )
        return id
    }

    private fun event(
        eventId: String = UUID.randomUUID().toString(),
        status: String = "RECEIVED",
        provider: String = "PLAY_RTDN",
        enc: ByteArray? = null,
    ) {
        jdbc.update(
            "INSERT INTO webhook_events (id, provider, event_id, status, purchase_token_enc) VALUES (?, ?, ?, ?, ?)",
            UUID.randomUUID(),
            provider,
            eventId,
            status,
            enc,
        )
    }

    @Test
    fun `V6 tables and indexes are present`() {
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version = '6' AND success", Int::class.java))
        listOf(
            "subscriptions_purchase_token_hash_key",
            "subscriptions_one_current_per_shop",
            "subscriptions_reverify_idx",
            "webhook_events_provider_event_key",
            "webhook_events_pending_idx",
        ).forEach { index ->
            assertEquals(
                1,
                jdbc.queryForObject(
                    "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?",
                    Int::class.java,
                    index,
                ),
                index,
            )
        }
    }

    @Test
    fun `subscription constraints hold`() {
        rejected { subscription(shop(), hash = "ABC") }
        rejected { subscription(shop(), hash = "0".repeat(63)) }
        rejected { subscription(shop(), state = "GOLD") }
        rejected { subscription(shop(), state = "REVOKED") }
        rejected { subscription(shop(), state = "REPLACED") }
        rejected { subscription(shop(), product = "") }
        rejected { subscription(shop(), product = "x".repeat(101)) }
        rollback {
            val shared = hash()
            subscription(shop(), hash = shared)
            assertFailsWith<DataIntegrityViolationException> { subscription(shop(), hash = shared) }
        }
        rollback {
            subscription(shop(), state = "REVOKED", revoked = true)
            subscription(shop(), state = "REPLACED", superseded = true)
            subscription(null, state = "ORPHANED")
            subscription(null, state = "ORPHANED")
        }
    }

    @Test
    fun `a shop has at most one current row`() {
        rollback {
            val shop = shop()
            subscription(shop, state = "EXPIRED", superseded = true)
            subscription(shop, state = "ON_HOLD", superseded = true)
            subscription(shop)
            assertFailsWith<DataIntegrityViolationException> { subscription(shop, state = "PENDING") }
        }
    }

    @Test
    fun `deleting the shop or the user keeps the row and clears the reference`() {
        rollback {
            val user = user()
            val shop = shop()
            val id = subscription(shop, linkedBy = user)
            jdbc.update("DELETE FROM shops WHERE id = ?", shop)
            jdbc.update("DELETE FROM users WHERE id = ?", user)
            val row = jdbc.queryForMap("SELECT shop_id, linked_by, purchase_token_hash FROM subscriptions WHERE id = ?", id)
            assertNull(row["shop_id"])
            assertNull(row["linked_by"])
            assertEquals(64, (row["purchase_token_hash"] as String).length)
        }
    }

    @Test
    fun `webhook event constraints hold`() {
        rollback {
            val id = "dup-" + UUID.randomUUID()
            event(id)
            assertFailsWith<DataIntegrityViolationException> { event(id) }
        }
        rejected { event(provider = "SMS_DLR") }
        rejected { event(status = "DONE") }
        rejected { event(eventId = "") }
        rejected { event(eventId = "x".repeat(129)) }
        rejected { event(status = "PROCESSED", enc = byteArrayOf(1, 2, 3)) }
        rejected {
            jdbc.update(
                "INSERT INTO webhook_events (id, provider, event_id, status, purchase_token_hash) VALUES (?, 'PLAY_RTDN', ?, 'RECEIVED', 'XYZ')",
                UUID.randomUUID(),
                UUID.randomUUID().toString(),
            )
        }
        rejected {
            jdbc.update(
                "INSERT INTO webhook_events (id, provider, event_id, status, attempts) VALUES (?, 'PLAY_RTDN', ?, 'RECEIVED', -1)",
                UUID.randomUUID(),
                UUID.randomUUID().toString(),
            )
        }
        rollback {
            event(status = "RECEIVED", enc = byteArrayOf(1, 2, 3))
            event(status = "FAILED")
        }
    }
}
