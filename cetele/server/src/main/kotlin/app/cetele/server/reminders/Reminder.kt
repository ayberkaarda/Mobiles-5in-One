package app.cetele.server.reminders

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "reminders")
class Reminder(
    @Column(name = "shop_id", nullable = false, updatable = false)
    override val shopId: UUID,
    @Column(name = "customer_id", nullable = false, updatable = false)
    val customerId: UUID,
    @Column(name = "statement_link_id")
    val statementLinkId: UUID?,
    @Column(name = "requested_by", updatable = false)
    val requestedBy: UUID?,
    @Column(name = "requested_at", nullable = false, updatable = false)
    val requestedAt: Instant,
) : TenantScoped {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    var id: UUID? = null

    @Column(name = "channel", nullable = false, updatable = false)
    val channel: String = "SMS"

    @Column(name = "template", nullable = false, updatable = false)
    val template: String = "BALANCE"

    @Column(name = "status", nullable = false)
    var status: String = "QUEUED"

    @Column(name = "provider_msg_id")
    var providerMessageId: String? = null

    @Column(name = "failure_code")
    var failureCode: String? = null

    @Column(name = "sent_at")
    var sentAt: Instant? = null

    @Column(name = "delivered_at")
    var deliveredAt: Instant? = null
}
