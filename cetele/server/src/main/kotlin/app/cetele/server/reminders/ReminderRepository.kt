package app.cetele.server.reminders

import app.cetele.server.tenancy.TenantRepository
import java.util.UUID

interface ReminderRepository : TenantRepository<Reminder> {
    fun findByShopIdAndId(
        shopId: UUID,
        id: UUID,
    ): Reminder?
}
