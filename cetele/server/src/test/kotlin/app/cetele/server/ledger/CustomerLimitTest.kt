package app.cetele.server.ledger

import app.cetele.server.support.IntegrationTest
import app.cetele.server.sync.SyncTestSupport
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

@IntegrationTest
class CustomerLimitTest : SyncTestSupport() {
    @Test
    fun `free live customer cap allows updates and frees space after deletion`() {
        val world = world()
        val existing = (1..100).map { ledger().customer(world.shopId) }
        assertCodes(push(world, listOf(customer(1))), "plan.customer_limit")
        assertCodes(push(world, listOf(customer(2, existing.first(), "Updated"))), null)
        assertCodes(push(world, listOf(delete(3, existing.last()), customer(4))), null, null)
        assertEquals(
            100,
            jdbc.queryForObject("SELECT count(*) FROM customers WHERE shop_id = ? AND deleted_at IS NULL", Int::class.java, world.shopId),
        )
        assertEquals(3L, ledger().head(world.shopId))
    }

    @Test
    fun `pro permits more than one hundred customers`() {
        val world = world()
        jdbc.update("UPDATE shops SET plan = 'PRO' WHERE id = ?", world.shopId)
        repeat(100) { ledger().customer(world.shopId) }
        assertCodes(push(world, listOf(customer(1))), null)
        assertEquals(101, jdbc.queryForObject("SELECT count(*) FROM customers WHERE shop_id = ?", Int::class.java, world.shopId))
    }
}
