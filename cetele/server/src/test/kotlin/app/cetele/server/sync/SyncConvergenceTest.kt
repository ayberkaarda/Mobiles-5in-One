package app.cetele.server.sync

import app.cetele.server.ledger.money.Balance
import app.cetele.server.ledger.money.BalanceLine
import app.cetele.server.support.IntegrationTest
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@IntegrationTest
class SyncConvergenceTest : SyncTestSupport() {
    @Test
    fun `two offline devices converge through replay rename deletion reversal and paging`() {
        val world = world()
        val c1 = id()
        val c2 = id()
        val debt = entry(2, c1)
        val a = listOf(customer(1, c1), debt)
        val b = listOf(customer(1, c2), entry(2, c2, 2000, "PAYMENT"), entry(3, c2, 7000))
        assertCodes(push(world, a), null, null)
        assertCodes(push(world, b, world.staff.bearer), null, null, null)
        assertEquals(pull(world), pull(world, world.staff.bearer))
        val deviceA = deviceState(pull(world))
        val deviceB = deviceState(pull(world, world.staff.bearer))
        assertEquals(deviceA, deviceB)
        assertEquals(setOf(c1.toString(), c2.toString()), deviceA.first.keys)
        assertEquals(3, deviceA.second.size)
        assertEquals(12_500L, deviceBalance(deviceA.second.values, c1))
        assertEquals(5000L, deviceBalance(deviceB.second.values, c2))
        assertEquals(12_500L, ledger().balance(world.shopId, c1))
        assertEquals(5000L, ledger().balance(world.shopId, c2))
        val head = ledger().head(world.shopId)
        val replay = push(world, a)
        assertTrue(replay.results.all { it.status == OperationStatus.DUPLICATE })
        assertEquals(a.map { it.customer?.id ?: it.entry!!.id }, replay.results.map { it.entityId })
        assertEquals(head, replay.head)
        assertCodes(push(world, listOf(customer(3, c1, "First rename"))), null)
        assertCodes(push(world, listOf(customer(4, c1, "Later rename")), world.staff.bearer), null)
        val ownerChanges = pull(world)
        assertEquals(ownerChanges, pull(world, world.staff.bearer))
        val snapshots: List<Map<String, Any?>> = JsonPath.read(ownerChanges, "$.changes")
        assertEquals("Later rename", (snapshots.last { it["entityId"] == c1.toString() }["payload"] as Map<*, *>)["name"])
        val beforeReversal = ledger().head(world.shopId)
        assertCodes(push(world, listOf(entry(5, c1, reverses = debt.entry!!.id)), world.staff.bearer), null)
        assertEquals(beforeReversal + 2, ledger().head(world.shopId))
        assertEquals(0L, ledger().balance(world.shopId, c1))
        val reversalChanges: List<Map<String, Any?>> = JsonPath.read(pull(world, since = beforeReversal), "$.changes")
        assertEquals(debt.entry.id.toString(), (reversalChanges.first()["payload"] as Map<*, *>)["reverses"])
        assertEquals(
            (reversalChanges.first()["payload"] as Map<*, *>)["id"],
            (reversalChanges.last()["payload"] as Map<*, *>)["reversedBy"],
        )
        assertCodes(push(world, listOf(delete(4, c1))), null)
        assertCodes(push(world, listOf(entry(6, c1), entry(7, c2, 100)), world.staff.bearer), "customer.deleted", null)
        assertCodes(push(world, listOf(customer(8), delete(9, c2), entry(10, c2, 200)), world.staff.bearer), null, "forbidden", null)
        assertCodes(push(world, listOf(customer(5, c1, "Resurrection"))), "customer.deleted")
        assertEquals(pull(world), pull(world, world.staff.bearer))
        val all: List<Map<String, Any?>> = JsonPath.read(pull(world), "$.changes")
        val paged = mutableListOf<Map<String, Any?>>()
        var cursor = 0L
        do {
            val page = pull(world, since = cursor, limit = 2)
            paged += JsonPath.read<List<Map<String, Any?>>>(page, "$.changes")
            val next: Number = JsonPath.read(page, "$.nextSince")
            cursor = next.toLong()
            val more: Boolean = JsonPath.read(page, "$.hasMore")
        } while (more)
        assertEquals(all, paged)
        assertEquals(ledger().head(world.shopId), cursor)
        val future = pull(world, since = cursor + 100)
        assertTrue(JsonPath.read<List<Any>>(future, "$.changes").isEmpty())
        assertEquals(cursor + 100, JsonPath.read<Number>(future, "$.nextSince").toLong())
        assertFalse(JsonPath.read(future, "$.hasMore"))
    }

    @Test
    fun `deleted customer replay is idempotent and revokes statement links`() {
        val world = world()
        val customerId = ledger().customer(world.shopId)
        val linkId = id()
        jdbc.update(
            "INSERT INTO statement_links (id, shop_id, customer_id, token_hash, expires_at) VALUES (?, ?, ?, ?, now() + interval '1 day')",
            linkId,
            world.shopId,
            customerId,
            java.util.HexFormat
                .of()
                .formatHex(
                    java.security.MessageDigest
                        .getInstance("SHA-256")
                        .digest(id().toString().toByteArray()),
                ),
        )
        val first = push(world, listOf(delete(1, customerId)))
        assertCodes(first, null)
        assertCodes(push(world, listOf(delete(2, customerId))), null)
        assertEquals(first.head, ledger().head(world.shopId))
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM statement_links WHERE shop_id = ? AND id = ? AND revoked_at IS NOT NULL",
                Int::class.java,
                world.shopId,
                linkId,
            ),
        )
    }

    private fun deviceState(body: String): Pair<Map<String, Map<String, Any?>>, Map<String, Map<String, Any?>>> {
        val customers = mutableMapOf<String, Map<String, Any?>>()
        val entries = mutableMapOf<String, Map<String, Any?>>()
        val changes: List<Map<String, Any?>> = JsonPath.read(body, "$.changes")
        changes.forEach { change ->
            @Suppress("UNCHECKED_CAST")
            val payload = change["payload"] as Map<String, Any?>
            val target = if (change["entity"] == "CUSTOMER") customers else entries
            target[change["entityId"] as String] = payload
        }
        return customers to entries
    }

    private fun deviceBalance(
        entries: Collection<Map<String, Any?>>,
        customerId: UUID,
    ): Long =
        Balance.of(
            entries.filter { it["customerId"] == customerId.toString() }.map { entry ->
                BalanceLine(
                    entry["type"] as String,
                    (entry["amountMinor"] as Number).toLong(),
                    (entry["reverses"] as String?)?.let(UUID::fromString),
                    (entry["reversedBy"] as String?)?.let(UUID::fromString),
                )
            },
        )
}
