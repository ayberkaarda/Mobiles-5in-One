package app.cetele.server.reminders.delivery

import app.cetele.server.config.JobLocks
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.data.domain.PageRequest
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Applies stored delivery reports to reminders (ADR-0032). A report is handed to a single worker
 * thread right after its insert commits, and a sweep every 30 seconds (under the `sms.dlr` job
 * lock) picks up anything that was missed. Quota and the daily cap are never touched: a report
 * changes history, not spend.
 */
@Component
class DeliveryReportProcessor(
    private val reports: SmsDeliveryReportRepository,
    private val index: ReminderDeliveryIndex,
    private val reminders: DeliveryReminderRepository,
    private val locks: JobLocks,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val log = LoggerFactory.getLogger(DeliveryReportProcessor::class.java)
    private val transaction =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }
    private val worker: ExecutorService =
        Executors.newSingleThreadExecutor { task -> Thread(task, "sms-dlr").apply { isDaemon = true } }

    /** Called after the insert of [id] committed; never blocks the request. */
    fun submit(id: UUID) {
        try {
            worker.execute { process(id) }
        } catch (_: RejectedExecutionException) {
            // Shutting down: the sweep applies it after the next start.
        }
    }

    @Scheduled(fixedDelay = SWEEP_MILLIS)
    fun scheduledSweep() {
        locks.runExclusive(LOCK_NAME) {
            processPending()
            val removed = transaction.execute { reports.deleteReceivedBefore(clock.instant().minus(RETENTION)) }
            if (removed != null && removed > 0) log.info("Sms dlr retention removed={}", removed)
        }
    }

    /** Processes every report still `RECEIVED`; returns how many were looked at. */
    fun processPending(): Int {
        val ids = transaction.execute { reports.pendingIds(MAX_ATTEMPTS, PageRequest.of(0, BATCH)) }.orEmpty()
        ids.forEach { process(it) }
        return ids.size
    }

    fun process(id: UUID) {
        try {
            transaction.executeWithoutResult { applyReport(id) }
        } catch (failure: RuntimeException) {
            log.warn("Sms dlr outcome=error type={}", failure.javaClass.simpleName)
            transaction.executeWithoutResult { recordFailure(id) }
        }
    }

    private fun applyReport(id: UUID) {
        val report = reports.lock(id) ?: return
        if (report.processing != SmsDeliveryReport.RECEIVED) return
        val now = clock.instant()
        val target = index.find(report.providerMessageId)
        if (target == null) {
            // The provider can report before the reminder row stores its message id: wait a little.
            if (report.receivedAt.plus(UNKNOWN_GRACE).isAfter(now)) return
            finish(report, SmsDeliveryReport.IGNORED, "unknown_message", now)
            return
        }
        val reminder = reminders.lock(target.shopId, target.reminderId)
        if (reminder == null) {
            finish(report, SmsDeliveryReport.IGNORED, "unknown_message", now)
            return
        }
        when {
            reminder.status == "DELIVERED" || reminder.status == "UNDELIVERED" -> {
                finish(report, SmsDeliveryReport.IGNORED, "already_final", now)
            }

            reminder.status == "SENT" || (reminder.status == "FAILED" && reminder.failureCode == OUTCOME_UNKNOWN) -> {
                if (report.status == SmsDeliveryReport.DELIVERED) {
                    reminder.status = "DELIVERED"
                    reminder.deliveredAt = report.occurredAt
                    reminder.failureCode = null
                } else {
                    reminder.status = "UNDELIVERED"
                    reminder.failureCode = "dlr." + (report.errorCode ?: "undelivered")
                }
                reminders.save(reminder)
                finish(report, SmsDeliveryReport.APPLIED, reminder.status.lowercase(), now)
            }

            else -> {
                finish(report, SmsDeliveryReport.IGNORED, "not_sent", now)
            }
        }
    }

    private fun finish(
        report: SmsDeliveryReport,
        processing: String,
        outcome: String,
        now: Instant,
    ) {
        report.processing = processing
        report.outcome = outcome
        report.processedAt = now
        reports.save(report)
        log.info("Sms dlr outcome={} processing={}", outcome, processing)
    }

    private fun recordFailure(id: UUID) {
        val report = reports.lock(id) ?: return
        if (report.processing != SmsDeliveryReport.RECEIVED) return
        report.attempts += 1
        if (report.attempts >= MAX_ATTEMPTS) {
            report.processing = SmsDeliveryReport.FAILED
            report.outcome = "error"
            report.processedAt = clock.instant()
        }
        reports.save(report)
    }

    @PreDestroy
    fun stop() {
        worker.shutdown()
    }

    companion object {
        const val LOCK_NAME = "sms.dlr"
        const val MAX_ATTEMPTS = 5
        private const val SWEEP_MILLIS = 30_000L
        private const val BATCH = 100
        private const val OUTCOME_UNKNOWN = "outcome_unknown"
        private val UNKNOWN_GRACE: Duration = Duration.ofMinutes(2)
        private val RETENTION: Duration = Duration.ofDays(90)
    }
}
