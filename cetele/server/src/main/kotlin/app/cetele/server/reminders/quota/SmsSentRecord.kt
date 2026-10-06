package app.cetele.server.reminders.quota

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.Immutable
import java.time.Instant
import java.util.UUID

/** Read-only view of reminder delivery fields, independent of the reminder write model. */
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
    @Column(name = "sent_at")
    val sentAt: Instant?,
) : TenantScoped
