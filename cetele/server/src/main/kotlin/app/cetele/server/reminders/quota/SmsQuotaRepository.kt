package app.cetele.server.reminders.quota

import app.cetele.server.tenancy.TenantRepository
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.LocalDate
import java.util.UUID

interface SmsQuotaRepository : TenantRepository<SmsQuota> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select q from SmsQuota q where q.shopId = :shopId and q.month = :month")
    fun lockMonth(
        @Param("shopId") shopId: UUID,
        @Param("month") month: LocalDate,
    ): SmsQuota?
}
