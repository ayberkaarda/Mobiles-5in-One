package app.cetele.server.tenancy

import app.cetele.server.security.ShopRole
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** One entry of `GET /v1/me` `memberships`. */
data class MembershipSummary(
    val shopId: UUID,
    val role: ShopRole,
)

/**
 * Read API for other modules: the shops the authenticated user belongs to.
 *
 * This is the one tenant-discovery query that is keyed by the caller's own user id (from the
 * verified token) instead of a shop id, which is why it is not a [TenantRepository] method. It
 * returns only the caller's own memberships in shops that are not deleted.
 */
@Service
class MembershipQuery(
    private val entityManager: EntityManager,
) {
    @Transactional(readOnly = true)
    fun membershipsOf(userId: UUID): List<MembershipSummary> =
        entityManager
            .createQuery(
                """
                select m.shopId, m.role from Membership m, Shop s
                where s.id = m.shopId and s.deletedAt is null and m.userId = :userId
                order by m.createdAt asc
                """.trimIndent(),
                Array<Any>::class.java,
            ).setParameter("userId", userId)
            .resultList
            .map { row -> MembershipSummary(shopId = row[0] as UUID, role = row[1] as ShopRole) }
}
