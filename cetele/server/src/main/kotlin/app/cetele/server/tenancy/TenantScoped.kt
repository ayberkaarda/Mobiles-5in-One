package app.cetele.server.tenancy

import java.util.UUID

/**
 * A row that belongs to exactly one shop. Such rows are read and written only through a
 * [TenantRepository] (architecture rule 1), so every query names the shop it is scoped to.
 */
interface TenantScoped {
    val shopId: UUID
}
