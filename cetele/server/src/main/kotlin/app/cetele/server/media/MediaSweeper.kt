package app.cetele.server.media

import app.cetele.server.config.JobLocks
import app.cetele.server.media.store.MediaStore
import jakarta.persistence.EntityManager
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

@Component
class MediaExpiryIndex(
    private val entityManager: EntityManager,
) {
    fun shops(before: Instant): List<UUID> =
        entityManager
            .createQuery(
                "select distinct m.shopId from MediaObject m where m.status = app.cetele.server.media.MediaStatus.PENDING and m.uploadExpiresAt < :before",
                UUID::class.java,
            ).setParameter("before", before)
            .resultList
}

@Component
class MediaSweeper(
    private val index: MediaExpiryIndex,
    private val repository: MediaObjectRepository,
    private val store: MediaStore,
    private val locks: JobLocks,
    private val clock: Clock,
) {
    @Scheduled(fixedDelay = 3_600_000)
    fun scheduledSweep() {
        sweep(clock.instant())
    }

    fun sweep(now: Instant): Int {
        var count = 0
        locks.runExclusive("media-sweeper") {
            val before = now.minus(Duration.ofHours(24))
            index.shops(before).forEach { shopId ->
                repository.expiredIds(shopId, before).forEach { id ->
                    val row = repository.lock(shopId, id)
                    if (row != null && row.status == MediaStatus.PENDING && row.uploadExpiresAt.isBefore(before)) {
                        store.delete(row.uploadKey)
                        row.status = MediaStatus.EXPIRED
                        count++
                    }
                }
            }
        }
        return count
    }
}
