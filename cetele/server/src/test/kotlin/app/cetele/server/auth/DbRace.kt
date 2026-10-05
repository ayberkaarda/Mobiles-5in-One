package app.cetele.server.auth

import org.springframework.jdbc.core.JdbcTemplate
import java.sql.Connection
import java.time.Duration
import java.time.Instant
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.LockSupport
import javax.sql.DataSource
import kotlin.test.fail

/**
 * Forces a precise interleaving of concurrent transactions against the real database, without
 * timing assumptions: a separate connection holds row locks ([hold]) so an application
 * transaction parks at a known statement, and [awaitLockWaiters] polls PostgreSQL until the
 * expected number of sessions is actually waiting on a lock before the test moves on.
 */
class DbRace(
    private val dataSource: DataSource,
    private val jdbc: JdbcTemplate,
) : AutoCloseable {
    private val executor: ExecutorService = Executors.newFixedThreadPool(THREADS)
    private val holders = mutableListOf<Connection>()

    /** Runs [sql] (a `SELECT ... FOR UPDATE`) in an open transaction kept until [releaseAll]. */
    fun hold(
        sql: String,
        vararg args: Any,
    ) {
        val connection = dataSource.connection
        connection.autoCommit = false
        connection.prepareStatement(sql).use { statement ->
            args.forEachIndexed { index, value -> statement.setObject(index + 1, value) }
            statement.executeQuery().use { rows -> check(rows.next()) { "nothing to lock" } }
        }
        holders += connection
    }

    fun releaseAll() {
        holders.forEach { connection ->
            connection.rollback()
            connection.close()
        }
        holders.clear()
    }

    fun <T> start(task: () -> T): Future<Result<T>> = executor.submit(Callable { runCatching(task) })

    /** Returns once at least [count] sessions of this database wait on a lock; fails after a deadline. */
    fun awaitLockWaiters(count: Int) {
        val deadline = Instant.now().plus(DEADLINE)
        while (waiting() < count) {
            if (Instant.now().isAfter(deadline)) fail("expected $count sessions waiting on a lock, saw ${waiting()}")
            LockSupport.parkNanos(POLL.toNanos())
        }
    }

    fun <T> result(future: Future<Result<T>>): Result<T> = future.get(DEADLINE.seconds, TimeUnit.SECONDS)

    private fun waiting(): Int =
        jdbc.queryForObject(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
            Int::class.java,
        )!!

    override fun close() {
        releaseAll()
        executor.shutdownNow()
    }

    companion object {
        private const val THREADS = 4
        private val DEADLINE: Duration = Duration.ofSeconds(30)
        private val POLL: Duration = Duration.ofMillis(5)
    }
}
