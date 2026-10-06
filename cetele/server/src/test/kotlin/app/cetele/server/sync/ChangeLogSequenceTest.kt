package app.cetele.server.sync

import app.cetele.server.security.CurrentUser
import app.cetele.server.support.IntegrationTest
import app.cetele.server.sync.apply.OperationApplier
import app.cetele.server.sync.changelog.ChangeLogWriter
import app.cetele.server.sync.changelog.ShopSequence
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@IntegrationTest
class ChangeLogSequenceTest : SyncTestSupport() {
    @Autowired lateinit var applier: OperationApplier

    @Autowired lateinit var sequence: ShopSequence

    @Autowired lateinit var writer: ChangeLogWriter

    @Autowired lateinit var transactions: PlatformTransactionManager

    @Test
    fun `eight concurrent writers publish unique contiguous commit ordered snapshots`() {
        val world = world()
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(8)
        try {
            val tasks =
                (1..8).map {
                    pool.submit(
                        Callable {
                            assertTrue(start.await(10, TimeUnit.SECONDS))
                            applier.apply(world.shopId, CurrentUser(world.owner.id, id()), customer(1))
                        },
                    )
                }
            start.countDown()
            tasks.forEach { assertEquals(OperationStatus.APPLIED, it.get(30, TimeUnit.SECONDS).status) }
        } finally {
            pool.shutdownNow()
        }
        val sequences = jdbc.queryForList("SELECT seq FROM change_log WHERE shop_id = ? ORDER BY seq", Long::class.java, world.shopId)
        assertEquals((1L..8L).toList(), sequences)
        assertEquals(8L, ledger().head(world.shopId))
        assertEquals(8, jdbc.queryForObject("SELECT count(*) FROM sync_outbox_receipts WHERE shop_id = ?", Int::class.java, world.shopId))
    }

    @Test
    fun `rollback publishes no snapshot or sequence advancement`() {
        val world = world()
        val tx = TransactionTemplate(transactions)
        tx.executeWithoutResult { status ->
            sequence.lock(world.shopId)
            writer.append(world.shopId, "CUSTOMER", id(), "UPSERT", "{}")
            status.setRollbackOnly()
        }
        assertEquals(0L, ledger().head(world.shopId))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM change_log WHERE shop_id = ?", Int::class.java, world.shopId))
        assertCodes(push(world, listOf(customer(1))), null)
        assertEquals(1L, ledger().head(world.shopId))
    }

    @Test
    fun `reader skips a reserved gap and preserves cursor order`() {
        val world = world()
        TransactionTemplate(transactions).executeWithoutResult {
            sequence.lock(world.shopId)
            assertEquals(1L, sequence.next(world.shopId))
        }
        assertCodes(push(world, listOf(customer(1))), null)
        val body = mapper.readTree(pull(world))
        assertEquals(2L, body["changes"][0]["seq"].asLong())
        assertEquals(2L, body["nextSince"].asLong())
        assertEquals(1, body["changes"].size())
    }
}
