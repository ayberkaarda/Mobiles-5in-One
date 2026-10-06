package app.cetele.server.account.deletion

import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.Repository
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

interface DeletionRequestRepository : Repository<DeletionRequest, UUID> {
    fun save(request: DeletionRequest): DeletionRequest

    @Query(
        "select d from DeletionRequest d where d.kind = 'ACCOUNT' and d.userId = :userId and d.cancelledAt is null and d.completedAt is null",
    )
    fun openAccount(
        @Param("userId") userId: UUID,
    ): DeletionRequest?

    @Query(
        "select d from DeletionRequest d where d.kind = 'SHOP' and d.shopId = :shopId and d.cancelledAt is null and d.completedAt is null",
    )
    fun openShop(
        @Param("shopId") shopId: UUID,
    ): DeletionRequest?

    @Query(
        "select d from DeletionRequest d where d.userId = :userId and d.kind = 'SHOP' and d.requestedAt = :requestedAt and d.cancelledAt is null and d.completedAt is null",
    )
    fun linkedShops(
        @Param("userId") userId: UUID,
        @Param("requestedAt") requestedAt: Instant,
    ): List<DeletionRequest>

    @Query(
        "select d.id from DeletionRequest d where d.graceUntil <= :now and d.cancelledAt is null and d.completedAt is null order by d.kind desc, d.requestedAt",
    )
    fun due(
        @Param("now") now: Instant,
    ): List<UUID>

    fun findById(id: UUID): DeletionRequest?
}
