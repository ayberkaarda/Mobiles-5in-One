package app.cetele.server.tenancy

import app.cetele.server.security.Permission
import app.cetele.server.security.PermissionMatrix
import app.cetele.server.security.ShopRole
import java.util.UUID

/**
 * The caller's standing in one shop, resolved from the database for the current request by
 * [MembershipResolver]. A plain value passed explicitly to services: there is no thread-local
 * holder, so a service can never act on a shop it was not handed.
 */
data class TenantContext(
    val shopId: UUID,
    val userId: UUID,
    val role: ShopRole,
) {
    fun can(permission: Permission): Boolean = PermissionMatrix.isAllowed(role, permission)
}
