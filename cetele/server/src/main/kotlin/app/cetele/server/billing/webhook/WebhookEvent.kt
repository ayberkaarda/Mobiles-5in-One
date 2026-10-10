package app.cetele.server.billing.webhook

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.Repository
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

enum class WebhookEventStatus {
    RECEIVED,
    PROCESSED,
    IGNORED,
    FAILED,
}

/**
 * One authenticated RTDN delivery, keyed by its Pub/Sub `messageId` (the replay guard). A row
 * without [notificationType] and with a token is a `voidedPurchaseNotification`. The encrypted
 * token is cleared as soon as the row leaves `RECEIVED` (`webhook_events_done_has_no_token`).
 */
@Entity
@Table(name = "webhook_events")
class WebhookEvent(
    @Column(name = "event_id", nullable = false, updatable = false)
    val eventId: String,
    @Column(name = "received_at", nullable = false, updatable = false)
    val receivedAt: Instant,
    @Column(name = "published_at", updatable = false)
    val publishedAt: Instant?,
    @Column(name = "notification_type", updatable = false)
    val notificationType: Int?,
    @Column(name = "purchase_token_hash", updatable = false)
    val purchaseTokenHash: String?,
    @Column(name = "purchase_token_enc")
    var purchaseTokenEnc: ByteArray?,
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    var status: WebhookEventStatus,
    @Column(name = "outcome")
    var outcome: String?,
    @Column(name = "next_attempt_at", nullable = false)
    var nextAttemptAt: Instant,
) {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Column(name = "id", nullable = false, updatable = false)
    var id: UUID? = null
        protected set

    @Column(name = "provider", nullable = false, updatable = false)
    val provider: String = PROVIDER_PLAY_RTDN

    @Column(name = "attempts", nullable = false)
    var attempts: Int = 0

    @Column(name = "processed_at")
    var processedAt: Instant? = null

    fun finish(
        status: WebhookEventStatus,
        outcome: String,
        now: Instant,
    ) {
        require(status != WebhookEventStatus.RECEIVED) { "a finished event leaves RECEIVED" }
        this.status = status
        this.outcome = outcome
        processedAt = now
        purchaseTokenEnc = null
    }

    companion object {
        const val PROVIDER_PLAY_RTDN = "PLAY_RTDN"
    }
}

interface WebhookEventRepository : Repository<WebhookEvent, UUID> {
    fun save(event: WebhookEvent): WebhookEvent

    @Query("select e from WebhookEvent e where e.id = :id")
    fun find(
        @Param("id") id: UUID,
    ): WebhookEvent?

    @Query("select count(e) > 0 from WebhookEvent e where e.provider = :provider and e.eventId = :eventId")
    fun exists(
        @Param("provider") provider: String,
        @Param("eventId") eventId: String,
    ): Boolean

    @Query(
        "select e.id from WebhookEvent e where e.status = app.cetele.server.billing.webhook.WebhookEventStatus.RECEIVED " +
            "and e.nextAttemptAt <= :now order by e.nextAttemptAt",
    )
    fun due(
        @Param("now") now: Instant,
        page: Pageable,
    ): List<UUID>

    @Modifying
    @Query("delete from WebhookEvent e where e.status in :statuses and e.receivedAt < :before")
    fun deleteFinishedBefore(
        @Param("statuses") statuses: Collection<WebhookEventStatus>,
        @Param("before") before: Instant,
    ): Int
}
