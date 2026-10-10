package app.cetele.server.reminders.delivery

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import java.time.Instant
import java.util.UUID

/** One accepted delivery report. Carries no shop, phone or text (ADR-0032). */
@Entity
@Table(name = "sms_delivery_reports")
class SmsDeliveryReport(
    @Column(name = "provider_msg_id", nullable = false, updatable = false)
    val providerMessageId: String,
    @Column(name = "status", nullable = false, updatable = false)
    val status: String,
    @Column(name = "error_code", updatable = false)
    val errorCode: String?,
    @Column(name = "occurred_at", nullable = false, updatable = false)
    val occurredAt: Instant,
    @Column(name = "received_at", nullable = false, updatable = false)
    val receivedAt: Instant,
) {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    var id: UUID? = null

    @Column(name = "processing", nullable = false)
    var processing: String = RECEIVED

    @Column(name = "outcome")
    var outcome: String? = null

    @Column(name = "attempts", nullable = false)
    var attempts: Int = 0

    @Column(name = "processed_at")
    var processedAt: Instant? = null

    companion object {
        const val RECEIVED = "RECEIVED"
        const val APPLIED = "APPLIED"
        const val IGNORED = "IGNORED"
        const val FAILED = "FAILED"
        const val DELIVERED = "DELIVERED"
        const val UNDELIVERED = "UNDELIVERED"
    }
}
