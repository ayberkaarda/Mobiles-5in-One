package app.cetele.server.billing

import app.cetele.server.billing.play.FakePlayDeveloperApi
import app.cetele.server.billing.play.PlayDeveloperApi
import app.cetele.server.billing.webhook.LocalRtdnSigner
import app.cetele.server.billing.webhook.RtdnExpectations
import app.cetele.server.billing.webhook.RtdnKeySource
import app.cetele.server.billing.webhook.RtdnProcessor
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.Actor
import app.cetele.server.tenancy.ShopWorld
import app.cetele.server.tenancy.TenancyFixtures
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.security.SecureRandom
import java.time.Clock
import java.util.Base64
import java.util.UUID
import kotlin.test.assertEquals

/**
 * Shared helpers of the billing integration tests: shops through the real API, purchases through
 * the fake Play adapter of profile `test`, and signed RTDN pushes from the local signer.
 */
abstract class BillingTestSupport {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var auth: TestAuth

    @Autowired lateinit var jdbc: JdbcTemplate

    @Autowired lateinit var clock: Clock

    @Autowired lateinit var playApi: PlayDeveloperApi

    @Autowired lateinit var keySource: RtdnKeySource

    @Autowired lateinit var expectations: RtdnExpectations

    @Autowired lateinit var processor: RtdnProcessor

    @Autowired lateinit var writer: SubscriptionWriter

    @Autowired lateinit var index: SubscriptionIndex

    val fake: FakePlayDeveloperApi get() = playApi as FakePlayDeveloperApi

    val signer: LocalRtdnSigner get() = keySource as LocalRtdnSigner

    fun tenancy() = TenancyFixtures(mvc, auth, jdbc)

    fun world(): ShopWorld = tenancy().world()

    /** A distinct `fake.sub.<state>.<shopId>.<suffix>` token. */
    fun token(
        state: String,
        shopId: UUID,
    ): String = FakePlayDeveloperApi.token(state, shopId, suffix())

    fun suffix(): String = (1..12).map { ALPHABET[random.nextInt(ALPHABET.length)] }.joinToString("")

    fun link(
        shopId: UUID,
        token: String,
        actor: Actor,
        productId: String = "cetele_pro",
    ): ResultActionsDsl =
        mvc.post("/v1/shops/$shopId/billing/link") {
            header(AUTHORIZATION, actor.bearer)
            contentType = MediaType.APPLICATION_JSON
            content = """{"productId":"$productId","purchaseToken":"$token"}"""
        }

    fun linkOk(
        shopId: UUID,
        token: String,
        actor: Actor,
    ): String {
        val response = link(shopId, token, actor).andReturn().response
        assertEquals(200, response.status, response.contentAsString)
        return response.contentAsString
    }

    fun billing(
        shopId: UUID,
        actor: Actor,
    ): ResultActionsDsl = mvc.get("/v1/shops/$shopId/billing") { header(AUTHORIZATION, actor.bearer) }

    fun plan(shopId: UUID): String = jdbc.queryForObject("SELECT plan FROM shops WHERE id = ?", String::class.java, shopId)!!

    fun key(token: String): SubscriptionKey {
        val ref = checkNotNull(index.byTokenHash(PurchaseTokens.hash(token))) { "token not stored" }
        return SubscriptionKey(checkNotNull(ref.shopId), ref.id)
    }

    fun row(token: String): Map<String, Any?> =
        jdbc.queryForMap("SELECT * FROM subscriptions WHERE purchase_token_hash = ?", PurchaseTokens.hash(token))

    fun state(token: String): String = row(token)["state"] as String

    fun rows(shopId: UUID): Int = jdbc.queryForObject("SELECT count(*) FROM subscriptions WHERE shop_id = ?", Int::class.java, shopId)!!

    /** The Pub/Sub push body for a `DeveloperNotification`. */
    fun envelope(
        notification: String,
        messageId: String = UUID.randomUUID().toString(),
    ): String {
        val data = Base64.getEncoder().encodeToString(notification.toByteArray(Charsets.UTF_8))
        return """{"message":{"data":"$data","messageId":"$messageId","publishTime":"2026-10-11T09:30:00.000Z","attributes":{}},""" +
            """"subscription":"projects/cetele-test/subscriptions/play-rtdn"}"""
    }

    fun subscriptionNotification(
        token: String,
        type: Int,
        packageName: String = PACKAGE,
        subscriptionId: String = "cetele_pro",
    ): String =
        """{"version":"1.0","packageName":"$packageName","eventTimeMillis":"1791711000000",""" +
            """"subscriptionNotification":{"version":"1.0","notificationType":$type,"purchaseToken":"$token","subscriptionId":"$subscriptionId"}}"""

    fun voidedNotification(
        token: String,
        productType: Int = 1,
    ): String =
        """{"version":"1.0","packageName":"$PACKAGE","eventTimeMillis":"1791711000000",""" +
            """"voidedPurchaseNotification":{"purchaseToken":"$token","orderId":"GPA.1234-5678","productType":$productType,"refundType":1}}"""

    fun push(
        body: String,
        bearer: String? = "Bearer " + signer.sign(expectations.audience),
    ): ResultActionsDsl =
        mvc.post(RtdnExpectations.PATH) {
            bearer?.let { header(AUTHORIZATION, it) }
            contentType = MediaType.APPLICATION_JSON
            content = body
        }

    fun pushOk(body: String) {
        val response = push(body).andReturn().response
        assertEquals(200, response.status, response.contentAsString)
        assertEquals("", response.contentAsString)
    }

    fun event(messageId: String): Map<String, Any?> = jdbc.queryForMap("SELECT * FROM webhook_events WHERE event_id = ?", messageId)

    fun events(messageId: String): Int =
        jdbc.queryForObject("SELECT count(*) FROM webhook_events WHERE event_id = ?", Int::class.java, messageId)!!

    companion object {
        const val PACKAGE = "app.cetele.android"
        private const val ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
        private val random = SecureRandom()
    }
}
