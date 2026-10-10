package app.cetele.server.billing.webhook

import app.cetele.server.billing.PurchaseTokens
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.time.Instant
import java.util.Base64

/** The kind of a decoded `DeveloperNotification`. */
sealed interface RtdnNotification {
    val packageName: String?

    data class Subscription(
        override val packageName: String?,
        val notificationType: Int,
        val purchaseToken: String,
        val subscriptionId: String?,
    ) : RtdnNotification {
        override fun toString() = "Subscription(type=$notificationType)"
    }

    data class Voided(
        override val packageName: String?,
        val purchaseToken: String,
        val productType: Int?,
    ) : RtdnNotification {
        override fun toString() = "Voided(productType=$productType)"
    }

    data class OneTimeProduct(
        override val packageName: String?,
    ) : RtdnNotification

    data class Test(
        override val packageName: String?,
    ) : RtdnNotification

    data class Other(
        override val packageName: String?,
    ) : RtdnNotification
}

/** One authenticated Pub/Sub push, parsed. */
data class RtdnMessage(
    val messageId: String,
    val publishedAt: Instant?,
    val notification: RtdnNotification,
)

/**
 * Parses the push envelope and its base64 `DeveloperNotification` (ADR-0032 steps 4 and 5). Returns
 * `null` for anything malformed; the caller answers 200 anyway so Pub/Sub does not redeliver it.
 * Field names per Google's public documentation, not verified against a live push.
 */
object RtdnEnvelope {
    const val SUBSCRIPTION_REVOKED = 12

    /** `voidedPurchaseNotification.productType` of a subscription. */
    const val PRODUCT_TYPE_SUBSCRIPTION = 1

    private const val MESSAGE_ID_MAX = 128

    fun parse(
        body: ByteArray,
        mapper: ObjectMapper,
    ): RtdnMessage? {
        val envelope = runCatching { mapper.readTree(body) }.getOrNull()?.takeIf { it.isObject } ?: return null
        val message = envelope.path("message").takeIf { it.isObject } ?: return null
        val messageId = (text(message, "messageId") ?: text(message, "message_id"))?.takeIf { it.length <= MESSAGE_ID_MAX } ?: return null
        val publishedAt =
            (text(message, "publishTime") ?: text(message, "publish_time"))?.let { runCatching { Instant.parse(it) }.getOrNull() }
        val data = text(message, "data") ?: return null
        val decoded = runCatching { Base64.getDecoder().decode(data) }.getOrNull() ?: return null
        val notification = runCatching { mapper.readTree(decoded) }.getOrNull()?.takeIf { it.isObject } ?: return null
        return RtdnMessage(messageId, publishedAt, kind(notification) ?: return null)
    }

    private fun kind(node: JsonNode): RtdnNotification? {
        val packageName = text(node, "packageName")
        val subscription = node.path("subscriptionNotification")
        val voided = node.path("voidedPurchaseNotification")
        return when {
            subscription.isObject -> {
                val type = subscription.path("notificationType").takeIf { it.isIntegralNumber }?.asInt() ?: return null
                val token = text(subscription, "purchaseToken")?.takeIf { PurchaseTokens.isWellFormed(it) } ?: return null
                RtdnNotification.Subscription(packageName, type, token, text(subscription, "subscriptionId"))
            }

            voided.isObject -> {
                val token = text(voided, "purchaseToken")?.takeIf { PurchaseTokens.isWellFormed(it) } ?: return null
                RtdnNotification.Voided(packageName, token, voided.path("productType").takeIf { it.isIntegralNumber }?.asInt())
            }

            node.path("oneTimeProductNotification").isObject -> {
                RtdnNotification.OneTimeProduct(packageName)
            }

            node.path("testNotification").isObject -> {
                RtdnNotification.Test(packageName)
            }

            else -> {
                RtdnNotification.Other(packageName)
            }
        }
    }

    private fun text(
        node: JsonNode,
        field: String,
    ): String? =
        node
            .path(field)
            .takeIf { it.isString }
            ?.asString()
            ?.takeIf { it.isNotEmpty() }
}
