package app.cetele.server.reminders.delivery

import jakarta.persistence.LockModeType
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.Repository
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

/** Delivery reports are provider keyed, not tenant keyed: there is no shop on the row. */
interface SmsDeliveryReportRepository : Repository<SmsDeliveryReport, UUID> {
    fun <S : SmsDeliveryReport> save(entity: S): S

    fun <S : SmsDeliveryReport> saveAndFlush(entity: S): S

    fun existsByProviderMessageId(providerMessageId: String): Boolean

    fun findByProviderMessageId(providerMessageId: String): SmsDeliveryReport?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from SmsDeliveryReport r where r.id = :id")
    fun lock(
        @Param("id") id: UUID,
    ): SmsDeliveryReport?

    @Query("select r.id from SmsDeliveryReport r where r.processing = 'RECEIVED' and r.attempts < :maxAttempts order by r.receivedAt")
    fun pendingIds(
        @Param("maxAttempts") maxAttempts: Int,
        pageable: Pageable,
    ): List<UUID>

    @Modifying
    @Query("delete from SmsDeliveryReport r where r.receivedAt < :before")
    fun deleteReceivedBefore(
        @Param("before") before: Instant,
    ): Int
}
