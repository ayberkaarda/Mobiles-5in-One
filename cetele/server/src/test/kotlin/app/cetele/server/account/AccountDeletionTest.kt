package app.cetele.server.account

import app.cetele.server.account.deletion.DeletionExecutor
import app.cetele.server.account.deletion.DeletionRequestRepository
import app.cetele.server.auth.UserStore
import app.cetele.server.config.JobLocks
import app.cetele.server.config.StorageProperties
import app.cetele.server.ledger.LedgerFixtures
import app.cetele.server.media.store.MediaStore
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.statements.link.StatementLinkService
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import software.amazon.awssdk.services.s3.S3Client
import java.time.Clock
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@IntegrationTest
class AccountDeletionTest : AccountTestSupport() {
    @Autowired private lateinit var executor: DeletionExecutor

    @Autowired private lateinit var media: MediaStore

    @Autowired private lateinit var links: StatementLinkService

    @Autowired private lateinit var s3: S3Client

    @Autowired private lateinit var storage: StorageProperties

    @Autowired private lateinit var requests: DeletionRequestRepository

    @Autowired private lateinit var accountStore: AccountStore

    @Autowired private lateinit var users: UserStore

    @Autowired private lateinit var jobs: JobLocks

    @Test
    fun `storage failure preserves database and request for the next run`() {
        val user = actor()
        val shopId = fixtures.shop(user.actor)
        val customer = LedgerFixtures(jdbc).customer(shopId)
        assertEquals(202, delete("/v1/me", user, mapOf("code" to code(user))).status)
        expire(user)
        val failingMedia =
            object : MediaStore by media {
                override fun deletePrefix(prefix: String): Unit = throw IllegalStateException("storage unavailable")
            }
        val failing =
            DeletionExecutor(
                requests,
                accountStore,
                users,
                failingMedia,
                org.springframework.jdbc.core.simple.JdbcClient
                    .create(jdbc),
                jobs,
                checkNotNull(tx.transactionManager),
                Clock.systemUTC(),
            )
        failing.run(Instant.now())
        assertEquals(1, count("users", "id", user.actor.id))
        assertEquals(1, count("shops", "id", shopId))
        assertEquals(1, count("customers", "id", customer))
        assertEquals(
            0,
            jdbc.queryForObject(
                "SELECT count(*) FROM deletion_requests WHERE user_id = ? AND completed_at IS NOT NULL",
                Int::class.java,
                user.actor.id,
            ),
        )
        executor.run(Instant.now())
        assertEquals(0, count("users", "id", user.actor.id))
        assertEquals(0, count("shops", "id", shopId))
    }

    @Test
    fun `completion removes all shop data storage and sessions and preserves completion evidence`() {
        val user = actor()
        val shopId = fixtures.shop(user.actor)
        val ledger = LedgerFixtures(jdbc)
        val customerId = ledger.customer(shopId, createdBy = user.actor.id)
        // A colleague in the deleted shop keeps their account; the user's rows in a foreign shop lose the pointer.
        val staff = actor()
        fixtures.addStaff(shopId, staff.actor)
        val foreignShop = fixtures.shop()
        fixtures.addStaff(foreignShop, user.actor)
        val foreignCustomer = ledger.customer(foreignShop, createdBy = user.actor.id)
        val mediaId = TraceIdFilter.uuidV7()
        val photo = "media/$shopId/$mediaId.jpg"
        val upload = "uploads/$shopId/$mediaId"
        media.put(photo, byteArrayOf(1, 2, 3), "image/jpeg")
        media.put(upload, byteArrayOf(4, 5, 6), "image/jpeg")
        val entry = ledger.entry(shopId, customerId, photoKey = photo, createdBy = user.actor.id)
        ledger.entry(shopId, customerId, reverses = entry)
        val link = links.issue(shopId, customerId, user.actor.id, now = Instant.now())
        jdbc.update(
            "INSERT INTO reminders (id, shop_id, customer_id, channel, template, status, statement_link_id, requested_by) VALUES (?, ?, ?, 'SMS', 'BALANCE', 'SENT', ?, ?)",
            UUID.randomUUID(),
            shopId,
            customerId,
            link.id,
            user.actor.id,
        )
        jdbc.update("INSERT INTO sms_quota (shop_id, month, used) VALUES (?, date_trunc('month', now())::date, 1)", shopId)
        jdbc.update(
            "INSERT INTO media_objects (id, shop_id, status, declared_content_type, declared_length, upload_key, photo_key, upload_expires_at, ready_at) VALUES (?, ?, 'READY', 'image/jpeg', 3, ?, ?, now(), now())",
            mediaId,
            shopId,
            upload,
            photo,
        )
        val invitationHash =
            java.util.HexFormat.of().formatHex(
                java.security.MessageDigest
                    .getInstance("SHA-256")
                    .digest(UUID.randomUUID().toString().toByteArray()),
            )
        jdbc.update(
            "INSERT INTO invitations (id, shop_id, phone_e164, code_hash, expires_at, created_by) VALUES (?, ?, ?, ?, now() + interval '1 day', ?)",
            UUID.randomUUID(),
            shopId,
            user.actor.phone,
            invitationHash,
            user.actor.id,
        )
        jdbc.update("INSERT INTO shop_sequences (shop_id, last_seq) VALUES (?, 1)", shopId)
        jdbc.update(
            "INSERT INTO change_log (id, shop_id, seq, entity, entity_id, op, payload) VALUES (?, ?, 1, 'CUSTOMER', ?, 'UPSERT', '{}'::jsonb)",
            UUID.randomUUID(),
            shopId,
            customerId,
        )
        jdbc.update(
            "INSERT INTO sync_outbox_receipts (id, shop_id, device_id, user_id, client_seq, client_id, entity_id) VALUES (?, ?, ?, ?, 1, ?, ?)",
            UUID.randomUUID(),
            shopId,
            user.deviceId,
            user.actor.id,
            UUID.randomUUID(),
            customerId,
        )
        jdbc.update(
            "INSERT INTO devices (id, user_id, device_id, model, app_version, last_seen_at) VALUES (?, ?, ?, 'Test phone', '1.0', now())",
            UUID.randomUUID(),
            user.actor.id,
            user.deviceId,
        )
        jdbc
            .update(
                "INSERT INTO refresh_tokens (id, token_hash, user_id, device_id, family_id, expires_at, family_expires_at) VALUES (?, ?, ?, ?, ?, now() + interval '60 days', now() + interval '180 days')",
                UUID
                    .randomUUID(),
                ByteArray(
                    32,
                ).also {
                    java.security.SecureRandom().nextBytes(it)
                },
                user.actor.id,
                user.deviceId,
                UUID.randomUUID(),
            )
        problem(delete("/v1/me", user, mapOf("code" to code(user))), 409, "account.owner_of_shared_shop")
        assertEquals(202, delete("/v1/me", user, mapOf("code" to code(user), "deleteOwnedShops" to true)).status)
        assertEquals(200, me(user).status)
        assertNotNull(media.head(photo))
        executor.run(Instant.now())
        assertEquals(1, count("shops", "id", shopId))
        expire(user)
        executor.run(Instant.now())
        val tables =
            jdbc.queryForList(
                "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'shop_id'",
                String::class.java,
            )
        // Completion records deliberately outlive the shop and have no foreign key.
        tables.filterNotNull().filter { it != "deletion_requests" }.forEach { assertEquals(0, count(it, "shop_id", shopId), it) }
        // Every uuid column of every table (a future table is covered too) holds neither id any more, and no
        // phone column holds the user's number: the only survivors are the completion records.
        val uuidColumns =
            jdbc.queryForList(
                "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'uuid'",
            )
        assertTrue(uuidColumns.size > 20, uuidColumns.toString())
        uuidColumns
            .map { it["table_name"] as String to it["column_name"] as String }
            .filter { (table, _) -> table != "deletion_requests" }
            .forEach { (table, column) ->
                assertEquals(0, count(table, column, shopId), "$table.$column shop")
                assertEquals(0, count(table, column, user.actor.id), "$table.$column user")
            }
        jdbc
            .queryForList(
                "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'phone_e164'",
                String::class.java,
            ).filterNotNull()
            .forEach { table ->
                assertEquals(
                    0,
                    jdbc.queryForObject("SELECT count(*) FROM $table WHERE phone_e164 = ?", Int::class.java, user.actor.phone),
                    "$table.phone_e164",
                )
            }
        assertEquals(1, count("users", "id", staff.actor.id))
        assertEquals(200, me(staff).status)
        assertEquals(1, count("customers", "id", foreignCustomer))
        assertEquals(1, count("shops", "id", foreignShop))
        assertEquals(0, count("shops", "id", shopId))
        assertEquals(0, count("users", "id", user.actor.id))
        assertEquals(0, count("devices", "user_id", user.actor.id))
        assertEquals(0, count("refresh_tokens", "user_id", user.actor.id))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM otp_codes WHERE phone_e164 = ?", Int::class.java, user.actor.phone))
        listOf("media/$shopId/", "uploads/$shopId/").forEach { prefix ->
            assertTrue(s3.listObjectsV2 { it.bucket(storage.bucketMedia).prefix(prefix) }.contents().isEmpty())
        }
        assertEquals(401, me(user).status)
        assertEquals(
            2,
            jdbc.queryForObject(
                "SELECT count(*) FROM deletion_requests WHERE user_id = ? AND completed_at IS NOT NULL",
                Int::class.java,
                user.actor.id,
            ),
        )
        executor.run(Instant.now())
        assertEquals(2, count("deletion_requests", "user_id", user.actor.id))
    }
}
