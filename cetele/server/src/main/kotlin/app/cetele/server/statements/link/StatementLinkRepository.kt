package app.cetele.server.statements.link

import app.cetele.server.tenancy.TenantRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

interface StatementLinkRepository : TenantRepository<StatementLink> {
    fun countByShopIdAndCustomerIdAndRevokedAtIsNullAndExpiresAtAfter(
        shopId: UUID,
        customerId: UUID,
        now: Instant,
    ): Long

    fun findByShopIdAndTokenHash(
        shopId: UUID,
        tokenHash: String,
    ): StatementLink?

    @Modifying
    @Query(
        "update StatementLink l set l.openedAt = :now, l.openCount = l.openCount + 1 where l.shopId = :shopId and l.id = :id and l.revokedAt is null and l.expiresAt > :now",
    )
    fun markOpened(
        @Param("shopId") shopId: UUID,
        @Param("id") id: UUID,
        @Param("now") now: Instant,
    ): Int

    @Modifying
    @Query("update StatementLink l set l.revokedAt = :now where l.shopId = :shopId and l.customerId = :customerId and l.revokedAt is null")
    fun revokeForCustomer(
        @Param("shopId") shopId: UUID,
        @Param("customerId") customerId: UUID,
        @Param("now") now: Instant,
    ): Int
}
