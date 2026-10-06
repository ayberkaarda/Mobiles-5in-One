package app.cetele.server.db

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
import kotlin.test.assertTrue

@IntegrationTest
class V4LedgerSchemaTest(
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val tx: TransactionTemplate,
) {
    private val fixtures = SchemaFixtures(jdbc, tx)

    @Test
    fun `V4 tables constraints and indexes are present`() {
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version = '4' AND success", Int::class.java))
        listOf("customers", "ledger_entries", "shop_sequences", "change_log", "sync_outbox_receipts").forEach { table ->
            assertEquals(
                1,
                jdbc.queryForObject(
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?",
                    Int::class.java,
                    table,
                ),
            )
        }
        listOf(
            "customers_shop_updated_idx",
            "customers_shop_live_idx",
            "ledger_entries_shop_customer_idx",
            "ledger_entries_shop_due_idx",
        ).forEach { index ->
            assertEquals(
                1,
                jdbc.queryForObject(
                    "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?",
                    Int::class.java,
                    index,
                ),
            )
        }
        val constraints =
            jdbc.queryForList(
                "SELECT conname FROM pg_constraint WHERE conrelid = 'ledger_entries'::regclass",
                String::class.java,
            )
        assertTrue(
            constraints.containsAll(
                listOf(
                    "ledger_entries_client_id_key",
                    "ledger_entries_reverses_key",
                    "ledger_entries_reversed_by_key",
                    "ledger_entries_photo_key_format",
                ),
            ),
        )
    }

    @Test
    fun `customer fields and consent evidence are enforced`() {
        listOf(
            "name = ''",
            "name = repeat('n', 81)",
            "phone_e164 = '05551234567'",
            "note = repeat('n', 501)",
            "tag = ''",
            "tag = repeat('t', 31)",
            "sms_consent_source = 'UNKNOWN'",
            "sms_consent = true",
        ).forEach { assignment ->
            fixtures.rejected { shop, customer ->
                jdbc.update("UPDATE customers SET $assignment WHERE id = ? AND shop_id = ?", customer, shop)
            }
        }
        fixtures.rollback {
            val (shop, customer) = fixtures.customer()
            jdbc.update(
                "UPDATE customers SET sms_consent = true, sms_consent_at = now(), sms_consent_source = 'IN_PERSON' WHERE id = ? AND shop_id = ?",
                customer,
                shop,
            )
        }
    }

    @Test
    fun `entry range type currency due date notes and keys are enforced`() {
        listOf(
            "amount_minor = 0",
            "amount_minor = 10000000001",
            "type = 'OTHER'",
            "currency = 'USD'",
            "note = repeat('n', 501)",
            "photo_key = 'uploads/wrong'",
            "type = 'PAYMENT', due_on = current_date",
            "reverses = id",
        ).forEach { assignment ->
            fixtures.rejected { shop, customer ->
                val entry = fixtures.entry(shop, customer)
                jdbc.update("UPDATE ledger_entries SET $assignment WHERE id = ? AND shop_id = ?", entry, shop)
            }
        }
        fixtures.rollback {
            val (shop, customer) = fixtures.customer()
            val entry = fixtures.entry(shop, customer)
            jdbc.update(
                "UPDATE ledger_entries SET amount_minor = 10000000000, photo_key = ? WHERE id = ?",
                "media/$shop/${UUID.randomUUID()}.jpg",
                entry,
            )
        }
    }

    @Test
    fun `entry idempotency and reversal references are unique`() {
        listOf("client_id", "reverses", "reversed_by").forEach { field ->
            fixtures.rejected { shop, customer ->
                val original = fixtures.entry(shop, customer)
                val first = fixtures.entry(shop, customer)
                val second = fixtures.entry(shop, customer)
                if (field == "client_id") {
                    jdbc.update(
                        "UPDATE ledger_entries SET client_id = (SELECT client_id FROM ledger_entries WHERE id = ?) WHERE id = ?",
                        first,
                        second,
                    )
                } else {
                    jdbc.update("UPDATE ledger_entries SET $field = ? WHERE id = ?", original, first)
                    jdbc.update("UPDATE ledger_entries SET $field = ? WHERE id = ?", original, second)
                }
            }
        }
    }

    @Test
    fun `change log sequences and receipt keys cannot collide`() {
        fixtures.rejected { shop, customer ->
            jdbc.update(
                "INSERT INTO change_log (id, shop_id, seq, entity, entity_id, op, payload) VALUES (?, ?, 1, 'CUSTOMER', ?, 'UPSERT', '{}'::jsonb)",
                UUID.randomUUID(),
                shop,
                customer,
            )
            jdbc.update(
                "INSERT INTO change_log (id, shop_id, seq, entity, entity_id, op, payload) VALUES (?, ?, 1, 'CUSTOMER', ?, 'UPSERT', '{}'::jsonb)",
                UUID.randomUUID(),
                shop,
                customer,
            )
        }
        listOf("seq = 0", "entity = 'OTHER'", "op = 'OTHER'").forEach { assignment ->
            fixtures.rejected { shop, customer ->
                val id = UUID.randomUUID()
                jdbc.update(
                    "INSERT INTO change_log (id, shop_id, seq, entity, entity_id, op, payload) VALUES (?, ?, 1, 'CUSTOMER', ?, 'UPSERT', '{}'::jsonb)",
                    id,
                    shop,
                    customer,
                )
                jdbc.update("UPDATE change_log SET $assignment WHERE id = ?", id)
            }
        }
        listOf(true, false).forEach { sameClient ->
            fixtures.rejected { shop, customer ->
                val device = UUID.randomUUID()
                val client = UUID.randomUUID()
                jdbc.update(
                    "INSERT INTO sync_outbox_receipts (id, shop_id, device_id, client_seq, client_id, entity_id) VALUES (?, ?, ?, 1, ?, ?)",
                    UUID.randomUUID(),
                    shop,
                    device,
                    client,
                    customer,
                )
                jdbc.update(
                    "INSERT INTO sync_outbox_receipts (id, shop_id, device_id, client_seq, client_id, entity_id) VALUES (?, ?, ?, ?, ?, ?)",
                    UUID.randomUUID(),
                    shop,
                    device,
                    if (sameClient) 2 else 1,
                    if (sameClient) client else UUID.randomUUID(),
                    customer,
                )
            }
        }
        fixtures.rejected { shop, _ ->
            jdbc.update("INSERT INTO shop_sequences (shop_id, last_seq) VALUES (?, -1)", shop)
        }
        fixtures.rejected { shop, customer ->
            jdbc.update(
                "INSERT INTO sync_outbox_receipts (id, shop_id, device_id, client_seq, client_id, entity_id) VALUES (?, ?, ?, 0, ?, ?)",
                UUID.randomUUID(),
                shop,
                UUID.randomUUID(),
                UUID.randomUUID(),
                customer,
            )
        }
    }
}

internal class SchemaFixtures(
    private val jdbc: JdbcTemplate,
    private val tx: TransactionTemplate,
) {
    fun customer(): Pair<UUID, UUID> {
        val user = UUID.randomUUID()
        val shop = UUID.randomUUID()
        val customer = UUID.randomUUID()
        jdbc.update("INSERT INTO users (id, phone_e164) VALUES (?, ?)", user, TestUsers.phone())
        jdbc.update(
            "INSERT INTO shops (id, name, type, il, ilce, created_by) VALUES (?, 'Shop', 'BAKKAL', 'City', 'District', ?)",
            shop,
            user,
        )
        jdbc.update("INSERT INTO customers (id, shop_id, name, created_by) VALUES (?, ?, 'Customer', ?)", customer, shop, user)
        return shop to customer
    }

    fun entry(
        shop: UUID,
        customer: UUID,
    ): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO ledger_entries (id, shop_id, customer_id, client_id, type, amount_minor, occurred_on) VALUES (?, ?, ?, ?, 'DEBT', 1, current_date)",
            id,
            shop,
            customer,
            UUID.randomUUID(),
        )
        return id
    }

    fun rollback(block: () -> Unit) =
        tx.executeWithoutResult { status ->
            try {
                block()
            } finally {
                status.setRollbackOnly()
            }
        }

    fun rejected(block: (UUID, UUID) -> Unit) =
        rollback {
            val (shop, customer) = customer()
            assertFailsWith<DataIntegrityViolationException> { block(shop, customer) }
        }
}
