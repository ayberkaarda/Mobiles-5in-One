package app.cetele.server.billing.play

import app.cetele.server.billing.PurchaseTokens
import java.time.Clock
import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Stand-in Play Developer API for the local and test profiles (`fake-play-developer-api`, refused
 * elsewhere by `LocalOnlyAdapterGuard`). It understands `fake.sub.<state>.<shopId>` with an optional
 * `.<[a-z0-9]{1,16}>` suffix; the shop id becomes the obfuscated account id. Tests can register an
 * exact purchase for any token with [put], and read the acknowledgements made with [acknowledgements].
 */
class FakePlayDeveloperApi(
    private val productId: String,
    private val clock: Clock,
) : PlayDeveloperApi {
    private val registered = ConcurrentHashMap<String, PlaySubscriptionResult>()
    private val acknowledged = CopyOnWriteArrayList<String>()
    private val acknowledgedSet = ConcurrentHashMap.newKeySet<String>()
    private val ackUnavailable = ConcurrentHashMap.newKeySet<String>()

    override fun getSubscription(purchaseToken: String): PlaySubscriptionResult {
        val result = registered[purchaseToken] ?: grammar(purchaseToken)
        if (result is PlaySubscriptionResult.Found && purchaseToken in acknowledgedSet) {
            return PlaySubscriptionResult.Found(result.purchase.copy(acknowledgementState = PlaySubscriptionPurchase.ACKNOWLEDGED))
        }
        return result
    }

    override fun acknowledge(
        productId: String,
        purchaseToken: String,
    ): PlayAckResult =
        when (if (purchaseToken in ackUnavailable) PlaySubscriptionResult.Unavailable(FAKE_REASON) else getSubscription(purchaseToken)) {
            is PlaySubscriptionResult.Found -> {
                acknowledged += purchaseToken
                acknowledgedSet += purchaseToken
                PlayAckResult.Acknowledged
            }

            PlaySubscriptionResult.NotFound -> {
                PlayAckResult.NotFound
            }

            is PlaySubscriptionResult.Unavailable -> {
                PlayAckResult.Unavailable(FAKE_REASON)
            }
        }

    /** Registers the answer for [token]; a later call replaces it (a state change). */
    fun put(
        token: String,
        purchase: PlaySubscriptionPurchase,
    ) {
        registered[token] = PlaySubscriptionResult.Found(purchase)
    }

    fun put(
        token: String,
        result: PlaySubscriptionResult,
    ) {
        registered[token] = result
    }

    /** Makes acknowledging [token] fail as unavailable until [allowAcknowledgement]. */
    fun refuseAcknowledgement(token: String) {
        ackUnavailable += token
    }

    fun allowAcknowledgement(token: String) {
        ackUnavailable -= token
    }

    /** Tokens acknowledged so far, in order (tokens of every test sharing this context). */
    fun acknowledgements(): List<String> = acknowledged.toList()

    /** A purchase of [state] for [shopId] in the shape the grammar produces, for tests to adjust. */
    fun purchase(
        state: String,
        shopId: UUID,
        expiry: Duration? = Duration.ofDays(30),
        product: String = productId,
        autoRenewing: Boolean = true,
        linkedPurchaseToken: String? = null,
        acknowledgementState: String = PlaySubscriptionPurchase.ACKNOWLEDGEMENT_PENDING,
    ): PlaySubscriptionPurchase =
        PlaySubscriptionPurchase(
            subscriptionState = state,
            acknowledgementState = acknowledgementState,
            linkedPurchaseToken = linkedPurchaseToken,
            obfuscatedExternalAccountId = PurchaseTokens.obfuscatedAccountId(shopId),
            testPurchase = true,
            lineItems = listOf(PlayLineItem(product, expiry?.let { clock.instant().plus(it) }, BASE_PLAN, autoRenewing)),
        )

    private fun grammar(token: String): PlaySubscriptionResult {
        val match = TOKEN.matchEntire(token) ?: return PlaySubscriptionResult.NotFound
        val shopText = match.groupValues[2]
        val shopId = runCatching { UUID.fromString(shopText) }.getOrNull()
        if (shopId == null || shopId.toString() != shopText) return PlaySubscriptionResult.NotFound
        val days = Duration::ofDays
        return when (match.groupValues[1]) {
            "active" -> found(purchase(PlaySubscriptionPurchase.STATE_ACTIVE, shopId, days(30)))
            "grace" -> found(purchase(PlaySubscriptionPurchase.STATE_IN_GRACE_PERIOD, shopId, days(3)))
            "canceled" -> found(purchase(PlaySubscriptionPurchase.STATE_CANCELED, shopId, days(10), autoRenewing = false))
            "hold" -> found(purchase(PlaySubscriptionPurchase.STATE_ON_HOLD, shopId, days(-1)))
            "paused" -> found(purchase(PlaySubscriptionPurchase.STATE_PAUSED, shopId, days(-1)))
            "expired" -> found(purchase(PlaySubscriptionPurchase.STATE_EXPIRED, shopId, days(-1), autoRenewing = false))
            "pending" -> found(purchase(PlaySubscriptionPurchase.STATE_PENDING, shopId, expiry = null))
            "otherproduct" -> found(purchase(PlaySubscriptionPurchase.STATE_ACTIVE, shopId, days(30), product = OTHER_PRODUCT))
            "unavailable" -> PlaySubscriptionResult.Unavailable(FAKE_REASON)
            else -> PlaySubscriptionResult.NotFound
        }
    }

    private fun found(purchase: PlaySubscriptionPurchase) = PlaySubscriptionResult.Found(purchase)

    companion object {
        const val ADAPTER_NAME = "fake-play-developer-api"
        const val OTHER_PRODUCT = "cetele_other"
        const val BASE_PLAN = "monthly"
        private const val FAKE_REASON = "fake"
        private val TOKEN = Regex("""fake\.sub\.([a-z]+)\.([0-9a-f-]{36})(?:\.[a-z0-9]{1,16})?""")

        /** `fake.sub.<state>.<shopId>[.<suffix>]`. */
        fun token(
            state: String,
            shopId: UUID,
            suffix: String? = null,
        ): String = "fake.sub.$state.$shopId" + (suffix?.let { ".$it" } ?: "")
    }
}
