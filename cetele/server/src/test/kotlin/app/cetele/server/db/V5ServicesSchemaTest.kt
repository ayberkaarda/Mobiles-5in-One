package app.cetele.server.db

import app.cetele.server.auth.token.RefreshTokenService
import app.cetele.server.config.JobLocks
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestUsers
import app.cetele.server.tenancy.ShopLocks
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class V5ServicesSchemaTest(
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val tx: TransactionTemplate,
    @Autowired private val dataSource: DataSource,
    @Autowired private val jobs: JobLocks,
    @Autowired private val shops: ShopLocks,
) {
    private val fixtures = SchemaFixtures(jdbc, tx)

    @Test
    fun `job locks skip competing transactions and shop locks require a transaction`() {
        val name = UUID.randomUUID().toString()
        assertTrue(
            jobs.runExclusive(name) {
                assertFalse(jobs.runExclusive(name) { error("held job lock must be skipped") })
            },
        )
        assertTrue(jobs.runExclusive(name) {})
        assertFailsWith<IllegalStateException> { shops.smsQuota(UUID.randomUUID()) }
        fixtures.rollback {
            val (shop, _) = fixtures.customer()
            shops.smsQuota(shop)
            shops.mediaQuota(shop)
            shops.deletion(shop)
        }
    }

    @Test
    fun `V5 service tables and indexes are present`() {
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version = '5' AND success", Int::class.java))
        listOf("statement_links", "reminders", "sms_quota", "media_objects", "deletion_requests").forEach { table ->
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
            "statement_links_shop_customer_idx",
            "reminders_shop_customer_idx",
            "reminders_sms_sent_idx",
            "reminders_provider_msg_id_key",
            "media_objects_shop_created_idx",
            "media_objects_pending_idx",
            "deletion_requests_open_account_key",
            "deletion_requests_open_shop_key",
            "deletion_requests_due_idx",
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
        assertEquals(
            0,
            jdbc.queryForObject(
                "SELECT count(*) FROM pg_constraint WHERE conrelid = 'deletion_requests'::regclass AND contype = 'f'",
                Int::class.java,
            ),
        )
    }

    @Test
    fun `statement link hash lifetime and open count are constrained`() {
        listOf("token_hash = 'wrong'", "expires_at = created_at", "open_count = -1").forEach { assignment ->
            fixtures.rejected { shop, customer ->
                val id = link(shop, customer)
                jdbc.update("UPDATE statement_links SET $assignment WHERE id = ?", id)
            }
        }
        fixtures.rejected { shop, customer ->
            val first = link(shop, customer)
            val second = link(shop, customer)
            jdbc.update(
                "UPDATE statement_links SET token_hash = (SELECT token_hash FROM statement_links WHERE id = ?) WHERE id = ?",
                first,
                second,
            )
        }
    }

    @Test
    fun `reminder enums failure code and provider id uniqueness are constrained`() {
        listOf("channel = 'EMAIL'", "template = 'OTHER'", "status = 'OTHER'", "failure_code = repeat('f', 65)").forEach { assignment ->
            fixtures.rejected { shop, customer ->
                val id = reminder(shop, customer)
                jdbc.update("UPDATE reminders SET $assignment WHERE id = ?", id)
            }
        }
        fixtures.rejected { shop, customer ->
            val first = reminder(shop, customer)
            val second = reminder(shop, customer)
            val provider = UUID.randomUUID().toString()
            jdbc.update("UPDATE reminders SET provider_msg_id = ? WHERE id = ?", provider, first)
            jdbc.update("UPDATE reminders SET provider_msg_id = ? WHERE id = ?", provider, second)
        }
        fixtures.rollback {
            val (shop, customer) = fixtures.customer()
            reminder(shop, customer)
            reminder(shop, customer)
        }
    }

    @Test
    fun `quota month and usage and media state are constrained`() {
        listOf("DATE '2026-10-02', 0", "DATE '2026-10-01', -1").forEach { values ->
            fixtures.rejected { shop, _ ->
                jdbc.update("INSERT INTO sms_quota (shop_id, month, used) VALUES (?, $values)", shop)
            }
        }
        listOf(
            "status = 'OTHER'",
            "declared_content_type = 'application/pdf'",
            "declared_length = 0",
            "declared_length = 1200001",
            "status = 'READY'",
            "photo_key = 'wrong'",
        ).forEach { assignment ->
            fixtures.rejected { shop, _ ->
                val id = UUID.randomUUID()
                jdbc.update(
                    "INSERT INTO media_objects (id, shop_id, status, declared_content_type, declared_length, upload_key, upload_expires_at) VALUES (?, ?, 'PENDING', 'image/jpeg', 1, ?, now() + interval '10 minutes')",
                    id,
                    shop,
                    "uploads/$shop/$id",
                )
                jdbc.update("UPDATE media_objects SET $assignment WHERE id = ?", id)
            }
        }
    }

    @Test
    fun `deletion requests enforce kind grace and only one open request`() {
        listOf("kind = 'OTHER'", "kind = 'SHOP'", "grace_until = requested_at - interval '1 second'").forEach { assignment ->
            fixtures.rejected { _, _ ->
                val id = deletion(UUID.randomUUID())
                jdbc.update("UPDATE deletion_requests SET $assignment WHERE id = ?", id)
            }
        }
        fixtures.rejected { _, _ ->
            val user = UUID.randomUUID()
            deletion(user)
            deletion(user)
        }
        fixtures.rollback {
            val user = UUID.randomUUID()
            val id = deletion(user)
            jdbc.update("UPDATE deletion_requests SET cancelled_at = now() WHERE id = ?", id)
            deletion(user)
        }
    }

    @Test
    fun `creator foreign keys become nullable and use SET NULL`() {
        fixtures.rollback {
            val (shop, customer) = fixtures.customer()
            val user = jdbc.queryForObject("SELECT created_by FROM shops WHERE id = ?", UUID::class.java, shop)!!
            val invitation = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO invitations (id, shop_id, phone_e164, code_hash, expires_at, created_by) VALUES (?, ?, ?, ?, now() + interval '1 day', ?)",
                invitation,
                shop,
                TestUsers.phone(),
                "a".repeat(64),
                user,
            )
            val entry = fixtures.entry(shop, customer)
            jdbc.update("UPDATE ledger_entries SET created_by = ? WHERE id = ?", user, entry)
            val link = link(shop, customer)
            jdbc.update("UPDATE statement_links SET created_by = ? WHERE id = ?", user, link)
            jdbc.update("DELETE FROM users WHERE id = ?", user)
            listOf(
                "shops" to shop,
                "customers" to customer,
                "invitations" to invitation,
                "ledger_entries" to entry,
                "statement_links" to link,
            ).forEach { (table, id) ->
                assertNull(jdbc.queryForMap("SELECT created_by FROM $table WHERE id = ?", id)["created_by"])
            }
        }
    }

    @Test
    fun `V5 backfills old refresh rows from their creation time`() {
        val schema = "upgrade_" + UUID.randomUUID().toString().replace("-", "")
        Flyway
            .configure()
            .dataSource(dataSource)
            .schemas(schema)
            .defaultSchema(schema)
            .target("3")
            .load()
            .migrate()
        val user = UUID.randomUUID()
        val row = UUID.randomUUID()
        val created = Instant.parse("2026-01-01T00:00:00Z")
        jdbc.update("INSERT INTO $schema.users (id, phone_e164) VALUES (?, ?)", user, TestUsers.phone())
        jdbc.update(
            "INSERT INTO $schema.refresh_tokens (id, token_hash, user_id, device_id, family_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            row,
            RefreshTokenService.hash(UUID.randomUUID().toString()),
            user,
            UUID.randomUUID(),
            UUID.randomUUID(),
            Timestamp.from(
                created.plusSeconds(60 * 86400L),
            ),
            Timestamp.from(created),
        )
        Flyway
            .configure()
            .dataSource(dataSource)
            .schemas(schema)
            .defaultSchema(schema)
            .load()
            .migrate()
        val familyEnd =
            jdbc
                .queryForObject(
                    "SELECT family_expires_at FROM $schema.refresh_tokens WHERE id = ?",
                    Timestamp::class.java,
                    row,
                )!!
                .toInstant()
        assertEquals(created.plus(RefreshTokenService.FAMILY_TTL), familyEnd)
        val nullable =
            jdbc.queryForObject(
                "SELECT is_nullable FROM information_schema.columns WHERE table_schema = ? AND table_name = 'refresh_tokens' AND column_name = 'family_expires_at'",
                String::class.java,
                schema,
            )
        assertEquals("NO", nullable)
        assertTrue(familyEnd.isAfter(created))
    }

    private fun link(
        shop: UUID,
        customer: UUID,
    ): UUID {
        val id = UUID.randomUUID()
        val hash =
            java.security.MessageDigest
                .getInstance("SHA-256")
                .digest(UUID.randomUUID().toString().toByteArray())
        jdbc.update(
            "INSERT INTO statement_links (id, shop_id, customer_id, token_hash, expires_at) VALUES (?, ?, ?, ?, now() + interval '30 days')",
            id,
            shop,
            customer,
            java.util.HexFormat
                .of()
                .formatHex(hash),
        )
        return id
    }

    private fun reminder(
        shop: UUID,
        customer: UUID,
    ): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO reminders (id, shop_id, customer_id, channel, template, status) VALUES (?, ?, ?, 'SMS', 'BALANCE', 'QUEUED')",
            id,
            shop,
            customer,
        )
        return id
    }

    private fun deletion(user: UUID): UUID {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO deletion_requests (id, kind, user_id, grace_until) VALUES (?, 'ACCOUNT', ?, now() + interval '14 days')",
            id,
            user,
        )
        return id
    }
}
