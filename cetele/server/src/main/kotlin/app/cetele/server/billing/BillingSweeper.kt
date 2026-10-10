package app.cetele.server.billing

import app.cetele.server.billing.play.PlayDeveloperApi
import app.cetele.server.billing.play.PlaySubscriptionResult
import app.cetele.server.billing.webhook.WebhookEventRepository
import app.cetele.server.billing.webhook.WebhookEventStatus
import app.cetele.server.config.JobLocks
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant

/** What one sweep did, for the log and the tests. */
data class BillingSweepResult(
    val reverified: Int,
    val unavailable: Int,
    val acknowledged: Int,
    val orphaned: Int,
    val eventsDeleted: Int,
)

/**
 * The hourly billing sweep (ADR-0031), under the `billing.sweep` job lock and behind
 * `CETELE_JOBS_ENABLED`: re-verifies current rows whose paid period ended or that were not
 * verified for 24 hours, retries acknowledgement, marks rows of deleted shops `ORPHANED`, and
 * deletes finished webhook rows (30 days, `FAILED` 90 days). A lost notification is corrected here.
 */
@Component
class BillingSweeper(
    private val index: SubscriptionIndex,
    private val writer: SubscriptionWriter,
    private val play: PlayDeveloperApi,
    private val events: WebhookEventRepository,
    private val jobs: JobLocks,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val log = LoggerFactory.getLogger(BillingSweeper::class.java)
    private val tx =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }

    @Scheduled(fixedDelay = 3_600_000, initialDelay = 60_000)
    fun scheduledSweep() {
        sweep(clock.instant())
    }

    /** Returns `null` when another instance holds the sweep lock. */
    fun sweep(now: Instant): BillingSweepResult? {
        var result: BillingSweepResult? = null
        jobs.runExclusive(JOB_LOCK) {
            val orphaned = tx.execute { index.orphanDetached(now) } ?: 0
            var reverified = 0
            var unavailable = 0
            index.reverifyCandidates(now, now.minus(STALE_AFTER), BATCH).forEach { key ->
                val token = writer.token(key)
                val answer = token?.let { play.getSubscription(it) }
                when (answer) {
                    is PlaySubscriptionResult.Found -> {
                        writer.refresh(key, answer.purchase, now, PlanChangeReason.SWEEP)
                        reverified++
                    }

                    PlaySubscriptionResult.NotFound -> {
                        writer.refresh(key, null, now, PlanChangeReason.SWEEP)
                        reverified++
                    }

                    is PlaySubscriptionResult.Unavailable, null -> {
                        // Time alone may have ended the entitlement; the plan follows even without Play.
                        writer.recompute(key.shopId, now, PlanChangeReason.SWEEP)
                        unavailable++
                    }
                }
            }
            var acknowledged = 0
            index.unacknowledged(BATCH).forEach { key ->
                val token = writer.token(key) ?: return@forEach
                if (writer.acknowledgeIfDue(key, token, now)) acknowledged++
            }
            val deleted =
                tx.execute {
                    events.deleteFinishedBefore(FINISHED, now.minus(FINISHED_RETENTION)) +
                        events.deleteFinishedBefore(listOf(WebhookEventStatus.FAILED), now.minus(FAILED_RETENTION))
                } ?: 0
            result = BillingSweepResult(reverified, unavailable, acknowledged, orphaned, deleted)
            log.info(
                "Billing sweep reverified={} unavailable={} acknowledged={} orphaned={} events_deleted={}",
                reverified,
                unavailable,
                acknowledged,
                orphaned,
                deleted,
            )
        }
        return result
    }

    companion object {
        const val JOB_LOCK = "billing.sweep"
        private const val BATCH = 500
        val STALE_AFTER: Duration = Duration.ofHours(24)
        val FINISHED_RETENTION: Duration = Duration.ofDays(30)
        val FAILED_RETENTION: Duration = Duration.ofDays(90)
        private val FINISHED = listOf(WebhookEventStatus.PROCESSED, WebhookEventStatus.IGNORED)
    }
}
