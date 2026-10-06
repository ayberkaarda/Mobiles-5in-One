package app.cetele.server.sync.apply

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "sync_outbox_receipts")
class SyncOutboxReceipt(
    @Id
    @Column(name = "id", nullable = false)
    val id: UUID,
    @Column(name = "shop_id", nullable = false)
    override val shopId: UUID,
    @Column(name = "device_id", nullable = false)
    val deviceId: UUID,
    @Column(name = "user_id", nullable = true)
    val userId: UUID?,
    @Column(name = "client_seq", nullable = false)
    val clientSeq: Long,
    @Column(name = "client_id", nullable = false)
    val clientId: UUID,
    @Column(name = "entity_id", nullable = false)
    val entityId: UUID,
    @Column(name = "applied_at", nullable = false)
    val appliedAt: Instant,
) : TenantScoped
