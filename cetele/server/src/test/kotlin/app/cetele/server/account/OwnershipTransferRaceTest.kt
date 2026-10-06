package app.cetele.server.account

import app.cetele.server.account.deletion.DeletionExecutor
import app.cetele.server.account.deletion.DeletionRequestRepository
import app.cetele.server.auth.UserStore
import app.cetele.server.config.JobLocks
import app.cetele.server.media.store.MediaStore
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.mock.web.MockHttpServletResponse
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@IntegrationTest
class OwnershipTransferRaceTest : AccountTestSupport() {
    @Autowired private lateinit var requests: DeletionRequestRepository

    @Autowired private lateinit var accountStore: AccountStore

    @Autowired private lateinit var users: UserStore

    @Autowired private lateinit var media: MediaStore

    @Autowired private lateinit var jobs: JobLocks

    @Test
    fun `transfer to a user whose account deletion is running waits and then finds the user gone`() {
        val owner = actor()
        val target = actor()
        val shopId = fixtures.shop(owner.actor)
        fixtures.addStaff(shopId, target.actor)
        assertEquals(202, delete("/v1/me", target, mapOf("code" to code(target))).status)
        // A solo shop opened during grace has no SHOP row of its own: the account completion deletes it while
        // holding the target's user row, which is where the executor pauses below.
        val targetShop = fixtures.shop(target.actor)

        // The executor stops inside the target's account completion (storage step of that shop), holding its locks.
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val pausing =
            object : MediaStore by media {
                override fun deletePrefix(prefix: String) {
                    // Pause only in the target's completion; other due rows left by earlier tests pass through.
                    if (prefix.contains(targetShop.toString())) {
                        entered.countDown()
                        check(release.await(60, TimeUnit.SECONDS)) { "test latch timed out" }
                    }
                    media.deletePrefix(prefix)
                }
            }
        val executor =
            DeletionExecutor(
                requests,
                accountStore,
                users,
                pausing,
                JdbcClient.create(jdbc),
                jobs,
                checkNotNull(tx.transactionManager),
                Clock.systemUTC(),
            )
        val threads = Executors.newFixedThreadPool(2)
        try {
            // The executor runs at a time past the grace end while the request itself is still inside its grace
            // for the transfer, so only the row locks (not the due-request check) keep the two apart.
            val run = threads.submit { executor.run(Instant.now().plus(Duration.ofDays(15))) }
            assertTrue(entered.await(60, TimeUnit.SECONDS))
            val value = code(owner)
            val transfer =
                threads.submit<MockHttpServletResponse> {
                    post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to target.actor.id, "code" to value))
                }
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            while (!transfer.isDone && lockWaiters() == 0 && System.nanoTime() < deadline) Thread.sleep(20)
            release.countDown()
            run.get(60, TimeUnit.SECONDS)
            val response = transfer.get(60, TimeUnit.SECONDS)

            assertEquals(0, count("users", "id", target.actor.id))
            problem(response, 404, "not_found")
            assertEquals("OWNER", fixtures.roleOf(shopId, owner.actor.id))
            assertEquals(
                1,
                jdbc.queryForObject("SELECT count(*) FROM memberships WHERE shop_id = ? AND role = 'OWNER'", Int::class.java, shopId),
            )
        } finally {
            release.countDown()
            threads.shutdownNow()
        }
    }

    private fun lockWaiters(): Int =
        jdbc.queryForObject(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
            Int::class.java,
        )!!
}
