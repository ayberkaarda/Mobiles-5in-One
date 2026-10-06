package app.cetele.server.media

import app.cetele.server.tenancy.TenantRepository
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

interface MediaObjectRepository : TenantRepository<MediaObject> {
    fun findByShopIdAndId(
        shopId: UUID,
        id: UUID,
    ): MediaObject?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from MediaObject m where m.shopId = :shopId and m.id = :id")
    fun lock(
        @Param("shopId") shopId: UUID,
        @Param("id") id: UUID,
    ): MediaObject?

    @Query(
        "select count(m) from MediaObject m where m.shopId = :shopId and m.createdAt >= :start and m.status in (app.cetele.server.media.MediaStatus.PENDING, app.cetele.server.media.MediaStatus.READY)",
    )
    fun countReserved(
        @Param("shopId") shopId: UUID,
        @Param("start") start: Instant,
    ): Long

    @Query(
        "select m.id from MediaObject m where m.shopId = :shopId and m.status = app.cetele.server.media.MediaStatus.PENDING and m.uploadExpiresAt < :before",
    )
    fun expiredIds(
        @Param("shopId") shopId: UUID,
        @Param("before") before: Instant,
    ): List<UUID>

    @Query(
        "select m.uploadKey from MediaObject m where m.shopId = :shopId and m.status <> app.cetele.server.media.MediaStatus.PENDING and m.uploadExpiresAt < :now and m.uploadExpiresAt >= :since",
    )
    fun staleUploadKeys(
        @Param("shopId") shopId: UUID,
        @Param("now") now: Instant,
        @Param("since") since: Instant,
    ): List<String>
}
