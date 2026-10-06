package app.cetele.server.reminders.quota

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.Immutable
import java.time.Instant
import java.util.UUID

/** Read-only view of the reminder fields that count toward the daily cap, independent of the write model. */
@Entity
@Immutable
@Table(name = "reminders")
class SmsSentRecord(
    @Id
    val id: UUID,
    @Column(name = "shop_id", nullable = false)
    override val shopId: UUID,
    @Column(name = "channel", nullable = false)
    val channel: String,
    @Column(name = "status", nullable = false)
    val status: String,
    @Column(name = "failure_code")
    val failureCode: String?,
    @Column(name = "requested_at", nullable = false)
    val requestedAt: Instant,
) : TenantScoped
