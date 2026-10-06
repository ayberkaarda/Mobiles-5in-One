package app.cetele.server.reminders.quota

import app.cetele.server.tenancy.TenantRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

interface SmsSentRecordRepository : TenantRepository<SmsSentRecord> {
    @Query("select count(r) from SmsSentRecord r where r.shopId = :shopId and r.channel = 'SMS' and r.sentAt >= :start and r.sentAt < :end")
    fun countSent(
        @Param("shopId") shopId: UUID,
        @Param("start") start: Instant,
        @Param("end") end: Instant,
    ): Long
}
