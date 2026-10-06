package app.cetele.server.ledger

import app.cetele.server.support.IntegrationTest
import app.cetele.server.sync.OperationStatus
import app.cetele.server.sync.SyncTestSupport
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

@IntegrationTest
class ReversalRulesTest : SyncTestSupport() {
    @Test
    fun `reversal must match customer type and amount and cannot reverse a reversal`() {
        val world = world()
        val c = ledger().customer(world.shopId)
        val other = ledger().customer(world.shopId)
        val original = ledger().entry(world.shopId, c)
        val operations =
            listOf(
                entry(1, other, reverses = original),
                entry(2, c, type = "PAYMENT", reverses = original),
                entry(3, c, amount = 1, reverses = original),
                entry(4, c, reverses = id()),
                entry(5, c, reverses = original).let { it.copy(entry = it.entry!!.copy(dueOn = it.entry.occurredOn)) },
                entry(6, c, reverses = original).let { it.copy(entry = it.entry!!.copy(photoKey = "media/${world.shopId}/${id()}.jpg")) },
            )
        assertCodes(
            push(world, operations),
            "ledger.reversal_mismatch",
            "ledger.reversal_mismatch",
            "ledger.reversal_mismatch",
            "ledger.reversal_mismatch",
            "validation.failed",
            "validation.failed",
        )
        assertEquals(0L, ledger().head(world.shopId))
        assertEquals(12_500L, ledger().balance(world.shopId, c))
        val reversal = entry(7, c, reverses = original)
        val applied = push(world, listOf(reversal), world.staff.bearer)
        assertCodes(applied, null)
        assertEquals(2L, applied.head)
        assertEquals(0L, ledger().balance(world.shopId, c))
        assertCodes(push(world, listOf(entry(8, c, reverses = original))), "ledger.already_reversed")
        assertCodes(push(world, listOf(entry(9, c, reverses = reversal.entry!!.id))), "ledger.reversal_mismatch")
        assertEquals(OperationStatus.DUPLICATE, push(world, listOf(reversal), world.staff.bearer).results.single().status)
        assertEquals(2L, ledger().head(world.shopId))
        assertNotNull(
            jdbc.queryForObject(
                "SELECT reversed_by FROM ledger_entries WHERE shop_id = ? AND id = ?",
                java.util.UUID::class.java,
                world.shopId,
                original,
            ),
        )
    }

    @Test
    fun `entry identity and device sequence cannot be reused`() {
        val world = world()
        val c = ledger().customer(world.shopId)
        val first = entry(1, c)
        assertCodes(push(world, listOf(first)), null)
        assertCodes(push(world, listOf(first.copy(clientId = id(), clientSeq = 2))), "conflict")
        assertCodes(push(world, listOf(entry(1, c))), "conflict")
        assertEquals(1L, ledger().head(world.shopId))
        assertEquals(12_500L, ledger().balance(world.shopId, c))
        assertEquals(
            OperationStatus.DUPLICATE,
            push(world, listOf(first.copy(entry = first.entry!!.copy(amountMinor = 0))), world.staff.bearer).results.single().status,
        )
    }
}
