package app.cetele.server.admin.audit

import app.cetele.server.config.JobLocks
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration
import java.time.Instant

/** Daily removal of audit rows older than 365 days, the only delete path of `audit_logs`. */
@Component
class AuditRetentionJob(
    private val rows: AuditLogRepository,
    private val jobs: JobLocks,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(AuditRetentionJob::class.java)

    @Scheduled(cron = "0 30 3 * * *", zone = "Europe/Istanbul")
    fun scheduled() {
        run(clock.instant())
    }

    fun run(now: Instant): Int {
        var removed = 0
        jobs.runExclusive("audit-retention") { removed = rows.deleteOlderThan(now.minus(RETENTION)) }
        log.info("Audit retention outcome=done removed={}", removed)
        return removed
    }

    companion object {
        val RETENTION: Duration = Duration.ofDays(365)
    }
}
