package app.cetele.server.account.retention

import app.cetele.server.config.JobLocks
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.sql.Timestamp
import java.time.Clock
import java.time.Duration
import java.time.Instant

data class RetentionCounts(
    val otpCodes: Int = 0,
    val refreshTokens: Int = 0,
    val invitations: Int = 0,
    val statementLinks: Int = 0,
    val mediaObjects: Int = 0,
)

@Component
class RetentionSweeper(
    private val jdbc: JdbcClient,
    private val jobs: JobLocks,
    private val clock: Clock,
) {
    @Scheduled(cron = "0 0 3 * * *", zone = "Europe/Istanbul")
    fun scheduled() = run(clock.instant())

    fun run(now: Instant): RetentionCounts {
        var counts = RetentionCounts()
        jobs.runExclusive("retention") {
            jdbc
                .sql(
                    """
                    UPDATE refresh_tokens SET rotated_from = NULL
                    WHERE rotated_from IN (
                        SELECT id FROM refresh_tokens WHERE revoked_at < :cutoff OR expires_at < :cutoff
                    )
                    """.trimIndent(),
                ).param("cutoff", Timestamp.from(now.minus(Duration.ofDays(30))))
                .update()
            counts =
                RetentionCounts(
                    otpCodes = remove("DELETE FROM otp_codes WHERE created_at < :cutoff", now, 1),
                    refreshTokens = remove("DELETE FROM refresh_tokens WHERE revoked_at < :cutoff OR expires_at < :cutoff", now, 30),
                    invitations = remove("DELETE FROM invitations WHERE expires_at < :cutoff", now, 7),
                    statementLinks = remove("DELETE FROM statement_links WHERE expires_at < :cutoff OR revoked_at < :cutoff", now, 90),
                    mediaObjects =
                        remove(
                            "DELETE FROM media_objects WHERE status IN ('FAILED', 'EXPIRED') AND created_at < :cutoff",
                            now,
                            7,
                        ),
                )
        }
        return counts
    }

    private fun remove(
        sql: String,
        now: Instant,
        days: Long,
    ): Int = jdbc.sql(sql).param("cutoff", Timestamp.from(now.minus(Duration.ofDays(days)))).update()
}
