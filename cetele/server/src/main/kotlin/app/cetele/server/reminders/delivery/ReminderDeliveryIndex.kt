package app.cetele.server.reminders.delivery

import app.cetele.server.reminders.Reminder
import app.cetele.server.tenancy.TenantRepository
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import jakarta.persistence.Tuple
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import org.springframework.stereotype.Component
import java.util.UUID

data class DeliveryTarget(
    val shopId: UUID,
    val reminderId: UUID,
)

/**
 * A provider message id belongs to the provider, not to a shop: only the shop and reminder ids are
 * read here, the update then goes through [DeliveryReminderRepository] with its `shopId`.
 */
@Component
class ReminderDeliveryIndex(
    private val entityManager: EntityManager,
) {
    fun find(providerMessageId: String): DeliveryTarget? =
        entityManager
            .createQuery("select r.shopId, r.id from Reminder r where r.providerMessageId = :id", Tuple::class.java)
            .setParameter("id", providerMessageId)
            .setMaxResults(1)
            .resultList
            .firstOrNull()
            ?.let { DeliveryTarget(it.get(0, UUID::class.java), it.get(1, UUID::class.java)) }
}

/** Tenant repository for the delivery update; the reminders package keeps its own repository untouched. */
interface DeliveryReminderRepository : TenantRepository<Reminder> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Reminder r where r.shopId = :shopId and r.id = :id")
    fun lock(
        @Param("shopId") shopId: UUID,
        @Param("id") id: UUID,
    ): Reminder?
}
