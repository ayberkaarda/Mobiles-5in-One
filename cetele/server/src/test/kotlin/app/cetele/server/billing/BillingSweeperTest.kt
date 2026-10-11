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
import java.time.temporal.ChronoUnit
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
    fun `older active and missing answers cannot overwrite a newer hold answer`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        val key = SubscriptionKey(world.shopId, row(token)["id"] as UUID)
        val t1 = clock.instant().plusSeconds(10).truncatedTo(ChronoUnit.MICROS)
        val t2 = t1.plusSeconds(10)
        val now = t2.plusSeconds(10)
        val hold = fake.purchase(PlaySubscriptionPurchase.STATE_ON_HOLD, world.shopId)
        val active = fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, world.shopId)
        writer.refresh(key, hold, now, PlanChangeReason.RTDN, 5, readAt = t2)
        writer.refresh(key, active, now.plusSeconds(1), PlanChangeReason.SWEEP, 2, readAt = t1)
        writer.refresh(key, null, now.plusSeconds(2), PlanChangeReason.SWEEP, readAt = t1)
        assertEquals("ON_HOLD", state(token))
        assertEquals("FREE", plan(world.shopId))
        assertEquals(t2, (row(token)["last_verified_at"] as Timestamp).toInstant())
        assertEquals(now, (row(token)["updated_at"] as Timestamp).toInstant())
        assertEquals(5, row(token)["last_notification_type"])
        writer.refresh(key, active, now.plusSeconds(3), PlanChangeReason.RTDN, 1, readAt = t2.plusSeconds(1))
        assertEquals("ACTIVE", state(token))
        assertEquals("PRO", plan(world.shopId))
    }

    @Test
    fun `older confirmed revocation cannot overwrite a newer active answer`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        val key = SubscriptionKey(world.shopId, row(token)["id"] as UUID)
        val t1 = clock.instant().plusSeconds(10).truncatedTo(ChronoUnit.MICROS)
        val t2 = t1.plusSeconds(10)
        writer.refresh(key, fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, world.shopId), t2, PlanChangeReason.RTDN)
        assertEquals(false, writer.revoke(key, t2.plusSeconds(1), PlanChangeReason.RTDN, 12, readAt = t1))
        assertEquals("ACTIVE", state(token))
        assertEquals("PRO", plan(world.shopId))
        assertNull(row(token)["revoked_at"])
        assertEquals(t2, (row(token)["last_verified_at"] as Timestamp).toInstant())
        assertEquals(true, writer.revoke(key, t2.plusSeconds(2), PlanChangeReason.RTDN, 12, readAt = t2.plusSeconds(1)))
        assertEquals("REVOKED", state(token))
        assertEquals("FREE", plan(world.shopId))
    }

    @Test
    fun `sweep verification time comes from the play read rather than the batch time`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_ON_HOLD, world.shopId))
        val before = clock.instant().truncatedTo(ChronoUnit.MICROS)
        val batchTime = before.plus(Duration.ofHours(25))
        sweeper.sweep(batchTime)
        val after = clock.instant().plusNanos(1_000)
        val verifiedAt = (row(token)["last_verified_at"] as Timestamp).toInstant()
        assertTrue(verifiedAt >= before && verifiedAt <= after)
        assertTrue(verifiedAt < batchTime)
        assertEquals("ON_HOLD", state(token))
        assertEquals("FREE", plan(world.shopId))
    }

    @Test
    fun `equal play read time is accepted`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        val key = SubscriptionKey(world.shopId, row(token)["id"] as UUID)
        val readAt = (row(token)["last_verified_at"] as Timestamp).toInstant()
        val hold = fake.purchase(PlaySubscriptionPurchase.STATE_ON_HOLD, world.shopId)
        writer.refresh(key, hold, readAt.plusSeconds(1), PlanChangeReason.SWEEP, readAt = readAt)
        assertEquals("ON_HOLD", state(token))
        assertEquals("FREE", plan(world.shopId))
        assertEquals(readAt, (row(token)["last_verified_at"] as Timestamp).toInstant())
    }

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
