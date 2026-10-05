package app.cetele.server.tenancy.membership

import app.cetele.server.tenancy.TenantRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.util.UUID

interface MembershipRepository : TenantRepository<Membership> {
    /** The caller's membership in a shop that is not deleted; `null` for non-members. */
    @Query(
        """
        select m from Membership m
        where m.shopId = :shopId and m.userId = :userId
          and exists (select s.id from Shop s where s.id = m.shopId and s.deletedAt is null)
        """,
    )
    fun findActive(
        @Param("shopId") shopId: UUID,
        @Param("userId") userId: UUID,
    ): Membership?

    fun existsByShopIdAndUserId(
        shopId: UUID,
        userId: UUID,
    ): Boolean

    fun findAllByShopIdOrderByCreatedAtAsc(shopId: UUID): List<Membership>
}
