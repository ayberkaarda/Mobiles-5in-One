package app.cetele.server.billing.webhook

import app.cetele.server.billing.BillingSettings
import app.cetele.server.billing.PurchaseTokenCipher
import app.cetele.server.billing.PurchaseTokens
import jakarta.persistence.PersistenceException
import org.slf4j.LoggerFactory
import org.springframework.dao.DataAccessException
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant

enum class RtdnReceipt {
    STORED,
    IGNORED,
    DUPLICATE,
}

/**
 * Stores an authenticated notification as a `webhook_events` row before any Play call (ADR-0032
 * step 6). Notifications billing never acts on (another package, a test, a one-time product,
 * another subscription product) are stored directly as `IGNORED` with their outcome; the rest wait
 * as `RECEIVED` with the token hashed and encrypted, for [RtdnProcessor].
 */
@Component
class RtdnInbox(
    private val events: WebhookEventRepository,
    private val cipher: PurchaseTokenCipher,
    private val settings: BillingSettings,
    transactionManager: PlatformTransactionManager,
) {
    private val tx = TransactionTemplate(transactionManager)
    private val log = LoggerFactory.getLogger(RtdnInbox::class.java)

    fun store(
        message: RtdnMessage,
        now: Instant,
    ): RtdnReceipt {
        val ignored = ignoreReason(message.notification)
        val receipt =
            try {
                tx.execute {
                    if (events.exists(WebhookEvent.PROVIDER_PLAY_RTDN, message.messageId)) return@execute RtdnReceipt.DUPLICATE
                    events.save(row(message, ignored, now))
                    if (ignored == null) RtdnReceipt.STORED else RtdnReceipt.IGNORED
                }
            } catch (_: DataAccessException) {
                RtdnReceipt.DUPLICATE
            } catch (_: PersistenceException) {
                RtdnReceipt.DUPLICATE
            }
        log.info(
            "Rtdn webhook outcome={} kind={}",
            if (receipt == RtdnReceipt.IGNORED) ignored else receipt?.name?.lowercase(),
            message.notification,
        )
        return receipt ?: RtdnReceipt.DUPLICATE
    }

    private fun row(
        message: RtdnMessage,
        ignored: String?,
        now: Instant,
    ): WebhookEvent {
        val notification = message.notification
        val token =
            when (notification) {
                is RtdnNotification.Subscription -> notification.purchaseToken
                is RtdnNotification.Voided -> notification.purchaseToken
                else -> null
            }
        val event =
            WebhookEvent(
                eventId = message.messageId,
                receivedAt = now,
                publishedAt = message.publishedAt,
                notificationType = (notification as? RtdnNotification.Subscription)?.notificationType,
                purchaseTokenHash = token?.let { PurchaseTokens.hash(it) },
                purchaseTokenEnc = token?.takeIf { ignored == null }?.let { cipher.encrypt(it) },
                status = WebhookEventStatus.RECEIVED,
                outcome = null,
                nextAttemptAt = now,
            )
        if (ignored != null) event.finish(WebhookEventStatus.IGNORED, ignored, now)
        return event
    }

    private fun ignoreReason(notification: RtdnNotification): String? =
        when {
            notification.packageName != settings.packageName -> "foreign_package"

            notification is RtdnNotification.Test -> "test"

            notification is RtdnNotification.OneTimeProduct -> "one_time_product"

            notification is RtdnNotification.Other -> "unknown_kind"

            notification is RtdnNotification.Subscription &&
                notification.subscriptionId != null &&
                notification.subscriptionId != settings.productId -> "foreign_product"

            notification is RtdnNotification.Voided &&
                notification.productType != null &&
                notification.productType != RtdnEnvelope.PRODUCT_TYPE_SUBSCRIPTION -> "one_time_product"

            else -> null
        }
}
