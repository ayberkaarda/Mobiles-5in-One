package app.cetele.server.account

import app.cetele.server.account.retention.RetentionSweeper
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.security.MessageDigest
import java.security.SecureRandom
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.HexFormat
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@IntegrationTest
class RetentionSweeperTest : AccountTestSupport() {
    @Autowired private lateinit var sweeper: RetentionSweeper

    @Test
    fun `retention removes only old eligible records and preserves boundary and active rows`() {
        val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS)
        val user = actor()
        val shopId = fixtures.shop(user.actor)
        val customerId =
            app.cetele.server.ledger
                .LedgerFixtures(jdbc)
                .customer(shopId)

        fun time(
            days: Long,
            extra: Long = 0,
        ) = Timestamp.from(now.minus(Duration.ofDays(days)).minusSeconds(extra))
        val oldOtp = UUID.randomUUID()
        val boundaryOtp = UUID.randomUUID()
        listOf(oldOtp to time(1, 1), boundaryOtp to time(1)).forEach { (id, created) ->
            jdbc.update(
                "INSERT INTO otp_codes (id, phone_e164, device_id, code_hmac, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
                id,
                user.actor.phone,
                user.deviceId,
                ByteArray(32),
                created,
                Timestamp.from(now),
            )
        }

        fun refresh(
            expires: Timestamp,
            revoked: Timestamp? = null,
            parent: UUID? = null,
        ): UUID {
            val id = UUID.randomUUID()
            val hash = ByteArray(32).also { SecureRandom().nextBytes(it) }
            jdbc.update(
                "INSERT INTO refresh_tokens (id, token_hash, user_id, device_id, family_id, expires_at, revoked_at, rotated_from, family_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id,
                hash,
                user.actor.id,
                user.deviceId,
                UUID.randomUUID(),
                expires,
                revoked,
                parent,
                Timestamp.from(now.plus(Duration.ofDays(180))),
            )
            return id
        }
        val expired = refresh(time(30, 1))
        val revoked = refresh(Timestamp.from(now.plusSeconds(1000)), time(30, 1))
        val child = refresh(Timestamp.from(now.plusSeconds(1000)), parent = revoked)
        val boundaryRefresh = refresh(time(30))

        fun invitation(expiry: Timestamp): UUID {
            val id = UUID.randomUUID()
            val hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(id.toString().toByteArray()))
            jdbc.update(
                "INSERT INTO invitations (id, shop_id, phone_e164, code_hash, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
                id,
                shopId,
                user.actor.phone,
                hash,
                expiry,
                time(10),
                user.actor.id,
            )
            return id
        }
        val oldInvitation = invitation(time(7, 1))
        val boundaryInvitation = invitation(time(7))

        fun link(
            expiry: Timestamp,
            revokedAt: Timestamp? = null,
        ): UUID {
            val id = UUID.randomUUID()
            val hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(id.toString().toByteArray()))
            jdbc.update(
                "INSERT INTO statement_links (id, shop_id, customer_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                id,
                shopId,
                customerId,
                hash,
                expiry,
                revokedAt,
                time(100),
            )
            return id
        }
        val oldLink = link(time(90, 1))
        val revokedLink = link(Timestamp.from(now.plusSeconds(1000)), time(90, 1))
        val boundaryLink = link(time(90))

        fun media(
            status: String,
            created: Timestamp,
        ): UUID {
            val id = UUID.randomUUID()
            jdbc.update(
                "INSERT INTO media_objects (id, shop_id, status, declared_content_type, declared_length, upload_key, created_at, upload_expires_at) VALUES (?, ?, ?, 'image/jpeg', 1, ?, ?, ?)",
                id,
                shopId,
                status,
                "uploads/$shopId/$id",
                created,
                Timestamp.from(now),
            )
            return id
        }
        val failed = media("FAILED", time(7, 1))
        val expiredMedia = media("EXPIRED", time(7, 1))
        val boundaryMedia = media("FAILED", time(7))
        val pending = media("PENDING", time(7, 1))
        val counts = sweeper.run(now)
        assertTrue(counts.otpCodes >= 1)
        assertTrue(counts.refreshTokens >= 2)
        assertTrue(counts.invitations >= 1)
        assertTrue(counts.statementLinks >= 2)
        assertTrue(counts.mediaObjects >= 2)
        mapOf(
            "otp_codes" to listOf(oldOtp),
            "refresh_tokens" to listOf(expired, revoked),
            "invitations" to listOf(oldInvitation),
            "statement_links" to listOf(oldLink, revokedLink),
            "media_objects" to listOf(failed, expiredMedia),
        ).forEach { (table, ids) ->
            ids.forEach { assertEquals(0, count(table, "id", it), table) }
        }
        mapOf(
            "otp_codes" to listOf(boundaryOtp),
            "refresh_tokens" to listOf(child, boundaryRefresh),
            "invitations" to listOf(boundaryInvitation),
            "statement_links" to listOf(boundaryLink),
            "media_objects" to listOf(boundaryMedia, pending),
        ).forEach { (table, ids) ->
            ids.forEach { assertEquals(1, count(table, "id", it), table) }
        }
        assertEquals(null, jdbc.queryForObject("SELECT rotated_from FROM refresh_tokens WHERE id = ?", UUID::class.java, child))
        assertEquals(
            app.cetele.server.account.retention
                .RetentionCounts(),
            sweeper.run(now),
        )
    }
}
