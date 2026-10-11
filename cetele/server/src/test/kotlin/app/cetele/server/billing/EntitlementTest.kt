package app.cetele.server.billing

import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import app.cetele.server.tenancy.shop.ShopPlan
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** One test per row of the state table of ADR-0031, through the link endpoint and the fake Play adapter. */
@IntegrationTest
class EntitlementTest : BillingTestSupport() {
    @Autowired lateinit var entitlement: EntitlementService

    private val now: Instant = Instant.parse("2026-10-11T09:30:00Z")

    /** Links a purchase of [playState] and returns (shop plan, stored state, entitled). */
    private fun linked(
        playState: String,
        expiry: Duration? = Duration.ofDays(30),
    ): Triple<String, String, Boolean> {
        val world = world()
        val token = token("active", world.shopId)
        fake.put(token, fake.purchase(playState, world.shopId, expiry))
        val body = linkOk(world.shopId, token, world.owner)
        return Triple(plan(world.shopId), JsonPath.read(body, "$.subscription.state"), JsonPath.read(body, "$.subscription.entitled"))
    }

    @Test
    fun `pending does not entitle`() {
        assertEquals(Triple("FREE", "PENDING", false), linked(PlaySubscriptionPurchase.STATE_PENDING, expiry = null))
    }

    @Test
    fun `active entitles`() {
        assertEquals(Triple("PRO", "ACTIVE", true), linked(PlaySubscriptionPurchase.STATE_ACTIVE))
    }

    @Test
    fun `grace period entitles`() {
        assertEquals(Triple("PRO", "IN_GRACE_PERIOD", true), linked(PlaySubscriptionPurchase.STATE_IN_GRACE_PERIOD, Duration.ofDays(3)))
    }

    @Test
    fun `account hold does not entitle`() {
        assertEquals(Triple("FREE", "ON_HOLD", false), linked(PlaySubscriptionPurchase.STATE_ON_HOLD, Duration.ofDays(-1)))
    }

    @Test
    fun `paused does not entitle`() {
        assertEquals(Triple("FREE", "PAUSED", false), linked(PlaySubscriptionPurchase.STATE_PAUSED, Duration.ofDays(-1)))
    }

    @Test
    fun `canceled entitles until the paid period ends`() {
        assertEquals(Triple("PRO", "CANCELED", true), linked(PlaySubscriptionPurchase.STATE_CANCELED, Duration.ofDays(10)))
        val end = now.plus(Duration.ofDays(10))
        assertTrue(Entitlement.entitles(SubscriptionState.CANCELED, end, end.minusMillis(1)))
        assertFalse(Entitlement.entitles(SubscriptionState.CANCELED, end, end))
        assertFalse(Entitlement.entitles(SubscriptionState.CANCELED, null, now))
    }

    @Test
    fun `expired and pending purchase canceled are expired and never stored new`() {
        assertEquals(SubscriptionState.EXPIRED, SubscriptionState.fromPlay(PlaySubscriptionPurchase.STATE_EXPIRED))
        assertEquals(SubscriptionState.EXPIRED, SubscriptionState.fromPlay(PlaySubscriptionPurchase.STATE_PENDING_PURCHASE_CANCELED))
        assertFalse(Entitlement.entitles(SubscriptionState.EXPIRED, now.plusSeconds(3600), now))
        listOf(PlaySubscriptionPurchase.STATE_EXPIRED, PlaySubscriptionPurchase.STATE_PENDING_PURCHASE_CANCELED).forEach { state ->
            val world = world()
            val token = token("active", world.shopId)
            fake.put(token, fake.purchase(state, world.shopId, Duration.ofDays(-1)))
            link(world.shopId, token, world.owner).expectProblem(422, "billing.purchase_invalid")
            assertEquals(0, rows(world.shopId))
        }
    }

    @Test
    fun `an expired update to a stored row is stored as expired and drops pro`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_PENDING_PURCHASE_CANCELED, world.shopId, Duration.ofDays(-1)))
        val body = linkOk(world.shopId, token, world.owner)
        assertEquals("EXPIRED", JsonPath.read(body, "$.subscription.state"))
        assertEquals("FREE", plan(world.shopId))
    }

    @Test
    fun `unspecified is not stored`() {
        assertNull(SubscriptionState.fromPlay(PlaySubscriptionPurchase.STATE_UNSPECIFIED))
        assertNull(SubscriptionState.fromPlay("SUBSCRIPTION_STATE_SOMETHING_NEW"))
        val world = world()
        val token = token("active", world.shopId)
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_UNSPECIFIED, world.shopId))
        link(world.shopId, token, world.owner).expectProblem(422, "billing.purchase_invalid")
        assertEquals(0, rows(world.shopId))
    }

    @Test
    fun `revoked is sticky`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        writer.revoke(key(token), clock.instant(), PlanChangeReason.RTDN)
        assertEquals("FREE", plan(world.shopId))
        // Whatever Play says afterwards, a revoked token never entitles again.
        fake.put(token, fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, world.shopId, Duration.ofDays(30)))
        writer.refresh(
            key(token),
            fake.purchase(PlaySubscriptionPurchase.STATE_ACTIVE, world.shopId),
            clock.instant(),
            PlanChangeReason.SWEEP,
        )
        val body = linkOk(world.shopId, token, world.owner)
        assertEquals("REVOKED", JsonPath.read(body, "$.subscription.state"))
        assertFalse(JsonPath.read(body, "$.subscription.entitled"))
        assertEquals("FREE", plan(world.shopId))
        assertFalse(Entitlement.entitles(SubscriptionState.REVOKED, now.plusSeconds(3600), now))
        // And the shop can buy again: a revoked current row does not entitle, so it is superseded.
        assertEquals("PRO", JsonPath.read(linkOk(world.shopId, token("active", world.shopId), world.owner), "$.plan"))
        assertEquals("REVOKED", state(token))
    }

    @Test
    fun `replaced and orphaned never entitle`() {
        listOf(SubscriptionState.REPLACED, SubscriptionState.ORPHANED).forEach { state ->
            assertTrue(state.sticky)
            assertFalse(Entitlement.entitles(state, now.plusSeconds(3600), now))
        }
        assertFalse(SubscriptionState.ACTIVE.sticky)
    }

    @Test
    fun `the one hour leeway covers a late renewal notification`() {
        val expiry = now.plus(Duration.ofDays(1))
        listOf(SubscriptionState.ACTIVE, SubscriptionState.IN_GRACE_PERIOD).forEach { state ->
            assertTrue(Entitlement.entitles(state, expiry, expiry))
            assertTrue(Entitlement.entitles(state, expiry, expiry.plus(Duration.ofMinutes(59))))
            assertFalse(Entitlement.entitles(state, expiry, expiry.plus(Duration.ofHours(1))))
            assertFalse(Entitlement.entitles(state, null, now))
        }

        // Through the service: the stored plan follows the instant of the recomputation.
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        val expiresAt = (row(token)["expires_at"] as Timestamp).toInstant()
        assertEquals(
            ShopPlan.PRO,
            entitlement.recompute(world.shopId, expiresAt.plus(Duration.ofMinutes(59)), PlanChangeReason.SWEEP),
        )
        assertEquals("PRO", plan(world.shopId))
        assertEquals(
            ShopPlan.FREE,
            entitlement.recompute(world.shopId, expiresAt.plus(Duration.ofMinutes(61)), PlanChangeReason.SWEEP),
        )
        assertEquals("FREE", plan(world.shopId))
        assertEquals(
            ShopPlan.PRO,
            entitlement.recompute(world.shopId, clock.instant(), PlanChangeReason.SWEEP),
        )
        assertNull(entitlement.recompute(UUID.randomUUID(), clock.instant(), PlanChangeReason.SWEEP))
    }
}
