package app.cetele.server.security

import app.cetele.server.security.Permission.CustomerRead
import app.cetele.server.security.Permission.CustomerWrite
import app.cetele.server.security.Permission.LedgerRead
import app.cetele.server.security.Permission.LedgerWrite
import app.cetele.server.security.Permission.MediaPresign
import app.cetele.server.security.Permission.ReminderSend
import app.cetele.server.security.Permission.ShopRead
import app.cetele.server.security.Permission.StatementLinkCreate

/**
 * Role x action grants, the single source of truth for authorization decisions.
 *
 * - OWNER: every shop action.
 * - STAFF: records debts and payments, manages customer profiles, sends reminders and statement links,
 *   attaches photos; never deletes customers, exports everything, manages members, edits the shop or billing.
 * - ADMIN and SUPPORT: shop metadata only through tenant actions; no customer data, no ledger reads or
 *   writes (support sees counts and metadata in the admin console). Admin-console actions are separate.
 *
 * Anything not listed is denied.
 */
object PermissionMatrix {
    private val grants: Map<Role, Set<Permission>> by lazy {
        mapOf(
            ShopRole.OWNER to Permission.all.toSet(),
            ShopRole.STAFF to
                setOf(
                    ShopRead,
                    CustomerRead,
                    CustomerWrite,
                    LedgerRead,
                    LedgerWrite,
                    ReminderSend,
                    StatementLinkCreate,
                    MediaPresign,
                ),
            PlatformRole.ADMIN to setOf(ShopRead),
            PlatformRole.SUPPORT to setOf(ShopRead),
        )
    }

    /** Roles covered by the matrix, in a stable order. */
    val roles: List<Role> = listOf(ShopRole.OWNER, ShopRole.STAFF, PlatformRole.ADMIN, PlatformRole.SUPPORT)

    fun isAllowed(
        role: Role,
        permission: Permission,
    ): Boolean = grants[role]?.contains(permission) ?: false

    fun permissionsOf(role: Role): Set<Permission> = grants[role] ?: emptySet()
}
