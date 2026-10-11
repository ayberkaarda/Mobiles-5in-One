package app.cetele.server.account

import app.cetele.server.account.deletion.DeletionExecutor
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class ShopDeletionTest : AccountTestSupport() {
    @Autowired private lateinit var executor: DeletionExecutor

    @Test
    fun `staff cannot delete and retains their account after shop deletion`() {
        val owner = actor()
        val staff = actor()
        val shopId = fixtures.shop(owner.actor)
        fixtures.addStaff(shopId, staff.actor)
        problem(delete("/v1/shops/$shopId", staff, mapOf("code" to code(staff))), 403, "forbidden")
        assertEquals(202, delete("/v1/shops/$shopId", owner, mapOf("code" to code(owner))).status)
        problem(delete("/v1/shops/$shopId", owner, mapOf("code" to code(owner))), 409, "shop.deletion_pending")
        expire(owner)
        executor.run(Instant.now())
        assertEquals(0, count("shops", "id", shopId))
        assertEquals(0, count("memberships", "shop_id", shopId))
        assertEquals(200, me(staff).status)
        assertEquals(200, me(owner).status)
    }

    @Test
    fun `shop deletion orphans the subscription, unnames audit rows and is audited`() {
        val owner = actor()
        val shopId = fixtures.shop(owner.actor)
        val subscriptionId = linkedSubscription(shopId, owner.actor.id)
        val adminId = TraceIdFilter.uuidV7()
        val viewed = TraceIdFilter.uuidV7()
        jdbc.update(
            "INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id) VALUES (?, 'ADMIN', ?, 'SHOP_VIEWED', 'SHOP', ?)",
            viewed,
            adminId,
            shopId,
        )
        assertEquals(202, delete("/v1/shops/$shopId", owner, mapOf("code" to code(owner))).status)
        val startedAt = Instant.now().minusSeconds(1)
        expire(owner)
        executor.run(Instant.now())
        assertEquals(0, count("shops", "id", shopId))
        val orphan = subscription(subscriptionId)
        assertEquals("ORPHANED", orphan["state"])
        assertNull(orphan["purchase_token_enc"])
        assertNull(orphan["shop_id"])
        // The owner keeps the account, so the subscription still records who linked it.
        assertEquals(owner.actor.id, orphan["linked_by"])
        val row = jdbc.queryForMap("SELECT actor_id, target_type, target_id FROM audit_logs WHERE id = ?", viewed)
        assertEquals(adminId, row["actor_id"])
        assertNull(row["target_type"])
        assertNull(row["target_id"])
        assertEquals(0, count("audit_logs", "target_id", shopId))
        assertTrue(completionRows("SHOP_DELETION_COMPLETED", startedAt, 1) >= 1)
        assertEquals(200, me(owner).status)
    }
}
