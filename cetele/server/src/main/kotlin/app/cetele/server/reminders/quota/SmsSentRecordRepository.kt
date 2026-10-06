package app.cetele.server.reminders.quota

import app.cetele.server.tenancy.TenantRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

interface SmsSentRecordRepository : TenantRepository<SmsSentRecord> {
    @Query(
        "select count(r) from SmsSentRecord r where r.shopId = :shopId and r.channel = 'SMS' " +
            "and r.requestedAt >= :start and r.requestedAt < :end and " +
            "(r.status in ('QUEUED', 'SENT', 'DELIVERED', 'UNDELIVERED') or " +
            "(r.status = 'FAILED' and r.failureCode = 'outcome_unknown'))",
    )
    fun countSpent(
        @Param("shopId") shopId: UUID,
        @Param("start") start: Instant,
        @Param("end") end: Instant,
    ): Long
}
