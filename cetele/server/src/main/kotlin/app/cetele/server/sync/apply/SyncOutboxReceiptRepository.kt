package app.cetele.server.sync.apply

import app.cetele.server.tenancy.TenantRepository
import java.util.UUID

interface SyncOutboxReceiptRepository : TenantRepository<SyncOutboxReceipt> {
    fun findByShopIdAndClientId(
        shopId: UUID,
        clientId: UUID,
    ): SyncOutboxReceipt?

    fun findByShopIdAndDeviceIdAndClientSeq(
        shopId: UUID,
        deviceId: UUID,
        clientSeq: Long,
    ): SyncOutboxReceipt?
}
