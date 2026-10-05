package app.cetele.server.tenancy

import app.cetele.server.security.CurrentUser
import app.cetele.server.security.Permission
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * The `perm` bean behind every tenant endpoint:
 *
 * ```
 * @PreAuthorize("@perm.can(#shopId, 'MEMBERS_MANAGE')")
 * ```
 *
 * The membership is read from the database on each call. A caller who is not a member of the shop
 * gets a `not_found` problem thrown from inside the expression, so 404 wins over 403 and the
 * response never reveals that the shop exists. A member whose role lacks the action gets `false`,
 * which method security turns into 403 `forbidden`.
 */
@Component("perm")
class PermissionEvaluator(
    private val resolver: MembershipResolver,
) {
    fun can(
        shopId: UUID?,
        action: String,
    ): Boolean {
        // An unknown action is a programming error in an annotation; it must never grant access.
        val permission = Permission.fromCode(action) ?: throw IllegalArgumentException("unknown permission code")
        val user =
            SecurityContextHolder.getContext().authentication?.principal as? CurrentUser
                ?: throw ProblemException(ProblemCode.AUTH_UNAUTHENTICATED, "permission check without a token principal")
        if (shopId == null) throw ProblemException(ProblemCode.NOT_FOUND, "permission check without a shop id")
        return resolver.resolve(shopId, user).can(permission)
    }
}
