package app.cetele.server.tenancy

import app.cetele.server.security.CurrentUser
import app.cetele.server.tenancy.membership.MembershipRepository
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/**
 * Turns a shop id from the request path into the caller's [TenantContext], reading the
 * membership from the database on every call (roles are never taken from the token).
 *
 * A caller without a membership in a live shop gets `not_found`: the response is identical for a
 * shop that does not exist and a shop the caller does not belong to.
 */
@Component
class MembershipResolver(
    private val memberships: MembershipRepository,
) {
    @Transactional(readOnly = true)
    fun resolve(
        shopId: UUID,
        currentUser: CurrentUser,
    ): TenantContext {
        val membership =
            memberships.findActive(shopId, currentUser.userId)
                ?: throw ProblemException(ProblemCode.NOT_FOUND, "no membership in the requested shop")
        return TenantContext(shopId = membership.shopId, userId = membership.userId, role = membership.role)
    }
}
