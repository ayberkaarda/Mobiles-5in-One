package app.cetele.server.reminders.quota

import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/** Enumerates only tenant ids for the platform-wide spending cap; rows stay tenant-scoped. */
@Component
class SmsSentIndex(
    private val entityManager: EntityManager,
) {
    fun shopsSentBetween(
        start: Instant,
        end: Instant,
    ): List<UUID> =
        entityManager
            .createQuery(
                "select distinct r.shopId from SmsSentRecord r where r.channel = 'SMS' and r.sentAt >= :start and r.sentAt < :end",
                UUID::class.java,
            ).setParameter("start", start)
            .setParameter("end", end)
            .resultList
}
