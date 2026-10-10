package app.cetele.server.billing.play

import org.springframework.http.HttpStatusCode
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.time.Instant

/**
 * The real Play Developer API adapter (`CETELE_BILLING_MODE=play`). [rest] carries the base URL
 * `https://androidpublisher.googleapis.com` and the timeouts (5 s connect, 10 s read); nothing is
 * retried inside a call. 400, 404 and 410 mean "not a purchase"; every other failure, including
 * 401/403 from Google and a missing access token, is "unavailable".
 *
 * Request and response shapes follow Google's public documentation and are not verified against
 * the live API (`not exercised: no Play Console account`, ADR-0031).
 */
class HttpPlayDeveloperApi(
    private val rest: RestClient,
    private val packageName: String,
    private val tokens: GoogleServiceAccountTokens,
    private val mapper: ObjectMapper,
) : PlayDeveloperApi {
    override fun getSubscription(purchaseToken: String): PlaySubscriptionResult {
        val bearer =
            try {
                tokens.accessToken()
            } catch (failure: GoogleTokenUnavailable) {
                return PlaySubscriptionResult.Unavailable(failure.message ?: "token")
            }
        return try {
            rest
                .get()
                .uri(SUBSCRIPTION_PATH, packageName, purchaseToken)
                .header("Authorization", "Bearer $bearer")
                .accept(MediaType.APPLICATION_JSON)
                .exchange { _, response ->
                    val status = response.statusCode
                    when {
                        status.is2xxSuccessful -> parse(response.body.readAllBytes())
                        isNotFound(status) -> PlaySubscriptionResult.NotFound
                        else -> PlaySubscriptionResult.Unavailable("http_${status.value()}")
                    }
                }
        } catch (exception: RestClientException) {
            PlaySubscriptionResult.Unavailable("transport")
        }
    }

    override fun acknowledge(
        productId: String,
        purchaseToken: String,
    ): PlayAckResult {
        val bearer =
            try {
                tokens.accessToken()
            } catch (failure: GoogleTokenUnavailable) {
                return PlayAckResult.Unavailable(failure.message ?: "token")
            }
        return try {
            rest
                .post()
                .uri(ACKNOWLEDGE_PATH, packageName, productId, purchaseToken)
                .header("Authorization", "Bearer $bearer")
                .contentType(MediaType.APPLICATION_JSON)
                .body("{}")
                .exchange { _, response ->
                    val status = response.statusCode
                    when {
                        status.is2xxSuccessful -> PlayAckResult.Acknowledged
                        isNotFound(status) -> PlayAckResult.NotFound
                        else -> PlayAckResult.Unavailable("http_${status.value()}")
                    }
                }
        } catch (exception: RestClientException) {
            PlayAckResult.Unavailable("transport")
        }
    }

    private fun isNotFound(status: HttpStatusCode): Boolean = status.value() in NOT_FOUND_STATUSES

    private fun parse(bytes: ByteArray): PlaySubscriptionResult {
        val node = runCatching { mapper.readTree(bytes) }.getOrNull()
        if (node == null || !node.isObject) return PlaySubscriptionResult.Unavailable("unparseable")
        val state = text(node, "subscriptionState") ?: PlaySubscriptionPurchase.STATE_UNSPECIFIED
        val lineItems =
            node.path("lineItems").takeIf { it.isArray }?.mapNotNull { item ->
                val productId = text(item, "productId") ?: return@mapNotNull null
                PlayLineItem(
                    productId = productId,
                    expiryTime = text(item, "expiryTime")?.let { runCatching { Instant.parse(it) }.getOrNull() },
                    basePlanId = text(item.path("offerDetails"), "basePlanId"),
                    autoRenewEnabled = item.path("autoRenewingPlan").path("autoRenewEnabled").let { it.isBoolean && it.asBoolean() },
                )
            } ?: emptyList()
        return PlaySubscriptionResult.Found(
            PlaySubscriptionPurchase(
                subscriptionState = state,
                acknowledgementState = text(node, "acknowledgementState") ?: "ACKNOWLEDGEMENT_STATE_UNSPECIFIED",
                linkedPurchaseToken = text(node, "linkedPurchaseToken"),
                obfuscatedExternalAccountId = text(node.path("externalAccountIdentifiers"), "obfuscatedExternalAccountId"),
                testPurchase = node.has("testPurchase") && !node.path("testPurchase").isNull,
                lineItems = lineItems,
            ),
        )
    }

    private fun text(
        node: JsonNode,
        field: String,
    ): String? =
        node
            .path(field)
            .takeIf { it.isString }
            ?.asString()
            ?.takeIf { it.isNotBlank() }

    companion object {
        const val BASE_URL = "https://androidpublisher.googleapis.com"
        const val SUBSCRIPTION_PATH = "/androidpublisher/v3/applications/{packageName}/purchases/subscriptionsv2/tokens/{token}"
        const val ACKNOWLEDGE_PATH =
            "/androidpublisher/v3/applications/{packageName}/purchases/subscriptions/{productId}/tokens/{token}:acknowledge"
        private val NOT_FOUND_STATUSES = setOf(400, 404, 410)
    }
}
