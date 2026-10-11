package app.cetele.server.billing.webhook

import app.cetele.server.billing.BillingTestSupport
import app.cetele.server.billing.PurchaseTokens
import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.billing.play.PlaySubscriptionResult
import app.cetele.server.config.JobLocks
import app.cetele.server.support.IntegrationTest
import com.jayway.jsonpath.JsonPath
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
class RtdnProcessingTest : BillingTestSupport() {
    @Autowired lateinit var jobs: JobLocks

    private fun deliver(notification: String): String {
        val messageId = "msg-" + suffix()
        pushOk(envelope(notification, messageId))
        processor.processDue(clock.instant())
        return messageId
    }

    private fun proShop(): Pair<UUID, String> {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        assertEquals("PRO", plan(world.shopId))
        return world.shopId to token
    }

    @Test
    fun `notification type never decides the state`() {
        val (shopId, token) = proShop()
        // SUBSCRIPTION_EXPIRED (13) while Play still says ACTIVE: Play wins.
        val id = deliver(subscriptionNotification(token, 13))
        assertEquals("verified", event(id)["outcome"])
        assertEquals("ACTIVE", state(token))
        assertEquals("PRO", plan(shopId))
        assertEquals(13, row(token)["last_notification_type"])
    }

    @Test
    fun `hold makes the shop free and recovery brings pro back after re-verification`() {
        val (shopId, token) = proShop()
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_ON_HOLD, shopId, Duration.ofDays(-1)))
        deliver(subscriptionNotification(token, 5))
        assertEquals("ON_HOLD", state(token))
        assertEquals("FREE", plan(shopId))
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, shopId, Duration.ofDays(30)))
        deliver(subscriptionNotification(token, 1))
        assertEquals("ACTIVE", state(token))
        assertEquals("PRO", plan(shopId))
    }

    @Test
    fun `grace keeps pro, pause makes free and cancellation keeps pro until expiry`() {
        val (shopId, token) = proShop()
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_IN_GRACE_PERIOD, shopId, Duration.ofDays(3)))
        deliver(subscriptionNotification(token, 6))
        assertEquals("IN_GRACE_PERIOD", state(token))
        assertEquals("PRO", plan(shopId))
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_PAUSED, shopId, Duration.ofDays(-1)))
        deliver(subscriptionNotification(token, 10))
        assertEquals("PAUSED", state(token))
        assertEquals("FREE", plan(shopId))
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_CANCELED, shopId, Duration.ofDays(5), autoRenewing = false))
        deliver(subscriptionNotification(token, 3))
        assertEquals("CANCELED", state(token))
        assertEquals(false, row(token)["auto_renewing"])
        assertEquals("PRO", plan(shopId))
    }

    @Test
    fun `expired play answer confirms revocation for ever`() {
        val world = world()
        val shopId = world.shopId
        val token = token("active", shopId)
        linkOk(shopId, token, world.owner)
        fake.put(token, fake.getSubscription("fake.sub.revoked.$shopId"))
        val id = deliver(subscriptionNotification(token, 12))
        assertEquals("revoked", event(id)["outcome"])
        assertEquals("REVOKED", state(token))
        assertNotNull(row(token)["revoked_at"])
        assertEquals("FREE", plan(shopId))
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, shopId))
        // A later active answer cannot restore a confirmed revocation.
        deliver(subscriptionNotification(token, 2))
        assertEquals("REVOKED", state(token))
        assertEquals("FREE", plan(shopId))
        val relinked = linkOk(shopId, token, world.owner)
        assertEquals("REVOKED", JsonPath.read(relinked, "$.subscription.state"))
        assertEquals("FREE", JsonPath.read(relinked, "$.plan"))
    }

    @Test
    fun `voided purchase revokes a known token`() {
        val (shopId, token) = proShop()
        fake.put(token, PlaySubscriptionResult.NotFound)
        val id = deliver(voidedNotification(token))
        assertEquals("PROCESSED", event(id)["status"])
        assertEquals("REVOKED", state(token))
        assertEquals("FREE", plan(shopId))
        assertNull(event(id)["notification_type"])
    }

    @Test
    fun `active play answer refuses both revocation notification kinds`() {
        val (shopId, token) = proShop()
        listOf(subscriptionNotification(token, 12), voidedNotification(token)).forEach { notification ->
            val id = deliver(notification)
            assertEquals("PROCESSED", event(id)["status"])
            assertEquals("revoke_unconfirmed", event(id)["outcome"])
            assertEquals("ACTIVE", state(token))
            assertEquals("PRO", plan(shopId))
            assertNull(row(token)["revoked_at"])
        }
    }

    @Test
    fun `notification verification time comes from the play read rather than the batch time`() {
        val (shopId, token) = proShop()
        val id = "read-" + suffix()
        pushOk(envelope(subscriptionNotification(token, 12), id))
        val before = clock.instant().truncatedTo(ChronoUnit.MICROS)
        val batchTime = before.plus(Duration.ofHours(1))
        processor.processDue(batchTime)
        val verifiedAt = (row(token)["last_verified_at"] as Timestamp).toInstant()
        assertTrue(verifiedAt >= before && verifiedAt <= clock.instant().plusNanos(1_000))
        assertTrue(verifiedAt < batchTime)
        assertEquals("revoke_unconfirmed", event(id)["outcome"])
        assertEquals("PRO", plan(shopId))
    }

    @Test
    fun `unavailable play answer retries both revocation notification kinds without revoking`() {
        val (shopId, token) = proShop()
        fake.put(token, PlaySubscriptionResult.Unavailable("fake"))
        listOf(subscriptionNotification(token, 12), voidedNotification(token)).forEach { notification ->
            val before = clock.instant().truncatedTo(ChronoUnit.MICROS)
            val id = deliver(notification)
            assertEquals("RECEIVED", event(id)["status"])
            assertEquals("unavailable", event(id)["outcome"])
            assertEquals(1, event(id)["attempts"])
            val nextAttempt = (event(id)["next_attempt_at"] as Timestamp).toInstant()
            val earliest = before.plus(Duration.ofMinutes(1))
            val latest = clock.instant().plus(Duration.ofMinutes(1)).plusNanos(1_000)
            assertTrue(nextAttempt >= earliest && nextAttempt <= latest)
            assertNotNull(event(id)["purchase_token_enc"])
            assertNull(row(token)["revoked_at"])
            assertEquals("ACTIVE", state(token))
            assertEquals("PRO", plan(shopId))
        }
    }

    @Test
    fun `ignored notifications record their outcome without a token`() {
        val token = token("active", UUID.randomUUID())
        val cases =
            mapOf(
                subscriptionNotification(token, 4, packageName = "com.other.app") to "foreign_package",
                """{"version":"1.0","packageName":"$PACKAGE","eventTimeMillis":"1","testNotification":{"version":"1.0"}}""" to "test",
                (
                    """{"version":"1.0","packageName":"$PACKAGE","eventTimeMillis":"1",""" +
                        """"oneTimeProductNotification":{"version":"1.0","notificationType":1,"purchaseToken":"$token","sku":"x"}}"""
                ) to "one_time_product",
                subscriptionNotification(token, 4, subscriptionId = "cetele_other") to "foreign_product",
                voidedNotification(token, productType = 2) to "one_time_product",
                """{"version":"1.0","packageName":"$PACKAGE","eventTimeMillis":"1"}""" to "unknown_kind",
            )
        cases.forEach { (notification, outcome) ->
            val messageId = "ign-" + suffix()
            pushOk(envelope(notification, messageId))
            val row = event(messageId)
            assertEquals("IGNORED", row["status"], outcome)
            assertEquals(outcome, row["outcome"])
            assertNull(row["purchase_token_enc"])
            assertNotNull(row["processed_at"])
        }
    }

    @Test
    fun `unknown token without a linked purchase is ignored`() {
        val shopId = world().shopId
        val token = token("active", shopId)
        val id = deliver(subscriptionNotification(token, 4))
        assertEquals("IGNORED", event(id)["status"])
        assertEquals("unknown_token", event(id)["outcome"])
        assertEquals(0, rows(shopId))
        assertEquals("FREE", plan(shopId))
        val revoked = deliver(subscriptionNotification(token("active", shopId), 12))
        assertEquals("unknown_token", event(revoked)["outcome"])
    }

    @Test
    fun `unknown token replacing the current row is linked from the notification`() {
        val (shopId, monthly) = proShop()
        val yearly = token("active", shopId)
        fake.put(yearly, fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, shopId, Duration.ofDays(365), linkedPurchaseToken = monthly))
        val id = deliver(subscriptionNotification(yearly, 4))
        assertEquals("replaced", event(id)["outcome"])
        assertEquals("REPLACED", state(monthly))
        assertEquals("ACTIVE", state(yearly))
        assertEquals(row(yearly)["id"], row(monthly)["replaced_by"])
        assertEquals(row(monthly)["linked_by"], row(yearly)["linked_by"])
        assertEquals("PRO", plan(shopId))
        assertTrue(yearly in fake.acknowledgements())

        // A token naming the current row but bought for another shop replaces nothing.
        val (otherShop, current) = proShop()
        val foreign = token("active", UUID.randomUUID())
        fake.put(
            foreign,
            fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, UUID.randomUUID(), Duration.ofDays(30), linkedPurchaseToken = current),
        )
        assertEquals("unknown_token", event(deliver(subscriptionNotification(foreign, 4)))["outcome"])
        assertEquals("ACTIVE", state(current))
        assertEquals(1, rows(otherShop))
    }

    @Test
    fun `play failures are retried with backoff and then failed`() {
        val (shopId, token) = proShop()
        fake.put(token, PlaySubscriptionResult.Unavailable("fake"))
        val id = "retry-" + suffix()
        pushOk(envelope(subscriptionNotification(token, 2), id))
        val start = clock.instant().truncatedTo(ChronoUnit.MICROS).plusSeconds(1)
        processor.processDue(start)
        var now = start
        val expected = listOf(1L, 5L, 15L, 60L, 360L)
        expected.forEachIndexed { index, minutes ->
            val row = event(id)
            assertEquals("RECEIVED", row["status"])
            assertEquals(index + 1, row["attempts"])
            assertEquals("unavailable", row["outcome"])
            assertNotNull(row["purchase_token_enc"])
            val next = (row["next_attempt_at"] as Timestamp).toInstant()
            assertEquals(now.plus(Duration.ofMinutes(minutes)), next)
            // Not due yet: nothing happens.
            processor.processDue(next.minusSeconds(1))
            assertEquals(index + 1, event(id)["attempts"])
            now = next
            processor.processDue(now)
        }
        val failed = event(id)
        assertEquals("FAILED", failed["status"])
        assertEquals(6, failed["attempts"])
        assertNull(failed["purchase_token_enc"])
        assertEquals("ACTIVE", state(token))
        assertEquals("PRO", plan(shopId))
    }

    @Test
    fun `processing runs under the job lock`() {
        pushOk(envelope(subscriptionNotification(token("active", UUID.randomUUID()), 4)))
        jobs.runExclusive(RtdnProcessor.JOB_LOCK) {
            assertEquals(0, processor.processDue(clock.instant()))
        }
        assertTrue(processor.processDue(clock.instant()) >= 1)
    }
}
