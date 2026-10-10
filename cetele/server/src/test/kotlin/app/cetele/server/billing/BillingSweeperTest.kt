package app.cetele.server.billing

import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.billing.play.PlaySubscriptionResult
import app.cetele.server.config.JobLocks
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class BillingSweeperTest : BillingTestSupport() {
    @Autowired lateinit var sweeper: BillingSweeper

    @Autowired lateinit var jobs: JobLocks

    @Test
    fun `canceled past its expiry becomes expired and the shop free`() {
        val world = world()
        val token = token("canceled", world.shopId)
        linkOk(world.shopId, token, world.owner)
        assertEquals("PRO", plan(world.shopId))
        val expiresAt = (row(token)["expires_at"] as Timestamp).toInstant()
        // Before the end of the paid period Play still says CANCELED and PRO stays.
        sweeper.sweep(expiresAt.minus(Duration.ofHours(1)))
        assertEquals("PRO", plan(world.shopId))
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_EXPIRED, world.shopId, Duration.ofDays(-1), autoRenewing = false))
        val result = assertNotNull(sweeper.sweep(expiresAt.plusSeconds(1)))
        assertTrue(result.reverified >= 1)
        assertEquals("EXPIRED", state(token))
        assertEquals("FREE", plan(world.shopId))
    }

    @Test
    fun `a lost notification is corrected by the daily re-verification`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_ON_HOLD, world.shopId, Duration.ofDays(-1)))
        sweeper.sweep(clock.instant().plus(Duration.ofHours(1)))
        assertEquals("ACTIVE", state(token))
        sweeper.sweep(clock.instant().plus(Duration.ofHours(25)))
        assertEquals("ON_HOLD", state(token))
        assertEquals("FREE", plan(world.shopId))
        assertNotNull(row(token)["last_verified_at"])
    }

    @Test
    fun `time alone ends the entitlement when play cannot be asked`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        val expiresAt = (row(token)["expires_at"] as Timestamp).toInstant()
        fake.put(token, PlaySubscriptionResult.Unavailable("fake"))
        val result = assertNotNull(sweeper.sweep(expiresAt.plus(Duration.ofMinutes(61))))
        assertTrue(result.unavailable >= 1)
        assertEquals("ACTIVE", state(token))
        assertEquals("FREE", plan(world.shopId))
    }

    @Test
    fun `acknowledgement is retried until play accepts it`() {
        val world = world()
        val token = token("active", world.shopId)
        fake.refuseAcknowledgement(token)
        linkOk(world.shopId, token, world.owner)
        assertNull(row(token)["acknowledged_at"])
        assertEquals("PRO", plan(world.shopId))
        sweeper.sweep(clock.instant())
        assertNull(row(token)["acknowledged_at"])
        fake.allowAcknowledgement(token)
        val result = assertNotNull(sweeper.sweep(clock.instant()))
        assertTrue(result.acknowledged >= 1)
        assertNotNull(row(token)["acknowledged_at"])
        assertTrue(token in fake.acknowledgements())
    }

    @Test
    fun `rows of deleted shops become orphaned and their token is never linked again`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        // What ON DELETE SET NULL does when the deletion executor removes the shop.
        jdbc.update("UPDATE subscriptions SET shop_id = NULL WHERE purchase_token_hash = ?", PurchaseTokens.hash(token))
        val result = assertNotNull(sweeper.sweep(clock.instant()))
        assertTrue(result.orphaned >= 1)
        val row = row(token)
        assertEquals("ORPHANED", row["state"])
        assertNull(row["purchase_token_enc"])
        assertEquals(PurchaseTokens.hash(token), row["purchase_token_hash"])
        val other = world()
        link(other.shopId, token, other.owner).expectProblem(409, "billing.token_in_use")
        link(world.shopId, token, world.owner).expectProblem(409, "billing.token_in_use")
    }

    @Test
    fun `finished webhook rows are deleted after their retention`() {
        val now = clock.instant()
        val ids =
            mapOf(
                "PROCESSED" to Duration.ofDays(31),
                "IGNORED" to Duration.ofDays(31),
                "FAILED" to Duration.ofDays(91),
            ).map { (status, age) -> insertEvent(status, now.minus(age)) }
        val kept =
            listOf(
                insertEvent("PROCESSED", now.minus(Duration.ofDays(29))),
                insertEvent("FAILED", now.minus(Duration.ofDays(60))),
                insertEvent("RECEIVED", now.minus(Duration.ofDays(200)), nextAttempt = now.plus(Duration.ofDays(365))),
            )
        val result = assertNotNull(sweeper.sweep(now))
        assertTrue(result.eventsDeleted >= 3)
        ids.forEach { assertEquals(0, events(it)) }
        kept.forEach { assertEquals(1, events(it)) }
        jdbc.update("DELETE FROM webhook_events WHERE event_id = ?", kept.last())
    }

    @Test
    fun `the sweep runs under its job lock`() {
        jobs.runExclusive(BillingSweeper.JOB_LOCK) {
            assertNull(sweeper.sweep(clock.instant()))
        }
        assertNotNull(sweeper.sweep(clock.instant()))
    }

    private fun insertEvent(
        status: String,
        receivedAt: Instant,
        nextAttempt: Instant = receivedAt,
    ): String {
        val id = "sweep-" + suffix()
        jdbc.update(
            "INSERT INTO webhook_events (id, provider, event_id, received_at, status, next_attempt_at) VALUES (?, 'PLAY_RTDN', ?, ?, ?, ?)",
            UUID.randomUUID(),
            id,
            Timestamp.from(receivedAt),
            status,
            Timestamp.from(nextAttempt),
        )
        return id
    }
}
