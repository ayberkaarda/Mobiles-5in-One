package app.cetele.server.security.attack

import app.cetele.server.billing.play.FakePlayDeveloperApi
import app.cetele.server.billing.play.PlayDeveloperApi
import app.cetele.server.billing.play.PlaySubscriptionPurchase
import app.cetele.server.billing.webhook.LocalRtdnSigner
import app.cetele.server.billing.webhook.RtdnExpectations
import app.cetele.server.billing.webhook.RtdnKeySource
import app.cetele.server.billing.webhook.RtdnProcessor
import app.cetele.server.reminders.delivery.DlrSignatureVerifier
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.MACSigner
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.security.SecureRandom
import java.time.Duration
import java.time.temporal.ChronoUnit
import java.util.Base64
import java.util.UUID
import kotlin.test.assertEquals

/**
 * Webhook forgery and replay over real HTTP (spec section 6 item 17, ADR-0032): the Play RTDN push
 * with forged, foreign, expired and replayed OIDC tokens, and the SMS delivery report with forged
 * signatures, stale timestamps, transplanted signatures, replays and a spoofed allowlisted source.
 * The push tokens are signed with the locally made key of profile `test` (ADR-0004 G2), the
 * delivery reports with a locally chosen secret (G4).
 */
@AttackTest
class WebhookAttackTest : AttackSupport() {
    @Autowired lateinit var keySource: RtdnKeySource

    @Autowired lateinit var expectations: RtdnExpectations

    @Autowired lateinit var processor: RtdnProcessor

    @Autowired lateinit var playApi: PlayDeveloperApi

    private val play: FakePlayDeveloperApi get() = playApi as FakePlayDeveloperApi

    private val signer: LocalRtdnSigner get() = keySource as LocalRtdnSigner

    private val random = SecureRandom()

    private fun envelope(
        notification: String,
        messageId: String,
    ): String {
        val data = Base64.getEncoder().encodeToString(notification.toByteArray(Charsets.UTF_8))
        return """{"message":{"data":"$data","messageId":"$messageId","publishTime":"2026-10-11T09:30:00.000Z","attributes":{}},""" +
            """"subscription":"projects/cetele-test/subscriptions/play-rtdn"}"""
    }

    private fun subscriptionNotification(
        token: String,
        type: Int,
    ) = """{"version":"1.0","packageName":"app.cetele.android","eventTimeMillis":"1791711000000",""" +
        """"subscriptionNotification":{"version":"1.0","notificationType":$type,"purchaseToken":"$token","subscriptionId":"cetele_pro"}}"""

    private fun push(
        body: String,
        authorization: String?,
    ) = call(
        "POST",
        RtdnExpectations.PATH,
        json = body,
        headers = authorization?.let { mapOf("Authorization" to it) } ?: emptyMap(),
    )

    private fun events(messageId: String): Int =
        jdbc.queryForObject("SELECT count(*) FROM webhook_events WHERE event_id = ?", Int::class.java, messageId)!!

    private fun messageId() = "attack-" + UUID.randomUUID()

    private fun valid() = "Bearer " + signer.sign(expectations.audience)

    @Test
    fun `forged rtdn push tokens are 401 and store nothing`() {
        val now = clock.instant()
        val audience = expectations.audience
        val genuine = signer.sign(audience)
        val (_, payload, signature) = genuine.split('.')
        val impostor = RSAKeyGenerator(2048).keyID(LocalRtdnSigner.KID).generate()
        val stranger = RSAKeyGenerator(2048).keyID("attacker-1").generate()
        val forged =
            mapOf(
                "no Authorization header" to null,
                "empty bearer" to "Bearer ",
                "garbage" to "Bearer not.a.jwt",
                "alg none" to "Bearer ${b64("""{"alg":"none","kid":"${LocalRtdnSigner.KID}"}""")}.$payload.",
                "alg none keeping the signature" to "Bearer ${b64(
                    """{"alg":"none","kid":"${LocalRtdnSigner.KID}"}""",
                )}.$payload.$signature",
                "HS256 under the real kid" to "Bearer " + hs256(audience),
                "impostor key under the real kid" to "Bearer " + signer.sign(audience, signingKey = impostor),
                "unknown kid" to "Bearer " + signer.sign(audience, signingKey = stranger),
                "another audience" to "Bearer " + signer.sign("https://attacker.invalid/v1/webhooks/play-rtdn"),
                "another issuer" to "Bearer " + signer.sign(audience, issuer = "https://attacker.invalid"),
                "another service account" to "Bearer " + signer.sign(audience, email = "attacker@example.invalid"),
                "unverified email" to "Bearer " + signer.sign(audience, emailVerified = false),
                "email_verified as a string" to "Bearer " + signer.sign(audience, emailVerified = "true"),
                "expired an hour ago" to "Bearer " + signer.sign(audience, issuedAt = now.minus(Duration.ofHours(2))),
                "issued in the future" to "Bearer " + signer.sign(audience, issuedAt = now.plus(Duration.ofMinutes(10))),
                "an api access token" to auth.bearer(auth.user()),
                "payload of another token" to "Bearer ${genuine.substringBefore('.')}.${b64("""{"aud":"$audience"}""")}.$signature",
            )
        forged.forEach { (name, authorization) ->
            val id = messageId()
            assertProblem(push(envelope("{}", id), authorization), 401, "webhook.unauthenticated", name)
            assertEquals(0, events(id), name)
        }
    }

    @Test
    fun `a captured push token is accepted again with another message inside its lifetime`() {
        // Finding F-03: the token is not bound to the body; what a new message may do is decided by processing.
        val authorization = valid()
        val ids = List(2) { messageId() }
        ids.forEach { id ->
            val body = envelope("""{"version":"1.0","packageName":"app.cetele.android","testNotification":{"version":"1.0"}}""", id)
            assertEquals(200, push(body, authorization).status)
        }
        assertEquals(listOf(1, 1), ids.map { events(it) })
    }

    @Test
    fun `a replayed rtdn message is stored once`() {
        val id = messageId()
        val body = envelope("""{"version":"1.0","packageName":"app.cetele.android","testNotification":{"version":"1.0"}}""", id)
        val authorization = valid()
        repeat(3) { assertEquals(200, push(body, authorization).status) }
        assertEquals(1, events(id))
    }

    @Test
    fun `a validly signed but forged notification cannot bring pro back`() {
        val owner = tenancy.actor()
        val shopId = tenancy.shop(owner)
        val token = FakePlayDeveloperApi.token("active", shopId, "forged")
        val linked = post("/v1/shops/$shopId/billing/link", """{"productId":"cetele_pro","purchaseToken":"$token"}""", owner.bearer)
        assertEquals(200, linked.status, linked.toString())
        assertEquals("PRO", plan(shopId))
        // Play now reports the subscription on hold; a real notification makes the shop free.
        play.put(token, play.purchase(PlaySubscriptionPurchase.STATE_ON_HOLD, shopId, Duration.ofDays(-1)))
        assertEquals(200, push(envelope(subscriptionNotification(token, 5), messageId()), valid()).status)
        processor.processDue(clock.instant())
        assertEquals("FREE", plan(shopId))
        // Forged recovery, renewal, purchase and restart notifications only make the server ask Play again.
        listOf(1, 2, 4, 7).forEach { type ->
            assertEquals(200, push(envelope(subscriptionNotification(token, type), messageId()), valid()).status)
        }
        processor.processDue(clock.instant())
        assertEquals("FREE", plan(shopId))
        assertEquals(
            "ON_HOLD",
            jdbc.queryForObject("SELECT state FROM subscriptions WHERE shop_id = ?", String::class.java, shopId),
        )
    }

    private fun plan(shopId: UUID): String = jdbc.queryForObject("SELECT plan FROM shops WHERE id = ?", String::class.java, shopId)!!

    @Test
    fun `captured push token with forged revocation keeps an active subscription pro`() {
        val owner = tenancy.actor()
        val shopId = tenancy.shop(owner)
        val token = FakePlayDeveloperApi.token("active", shopId, "revoke")
        val body = """{"productId":"cetele_pro","purchaseToken":"$token"}"""
        assertEquals(200, post("/v1/shops/$shopId/billing/link", body, owner.bearer).status)
        val authorization = valid()
        val id = messageId()
        assertEquals(200, push(envelope(subscriptionNotification(token, 12), id), authorization).status)
        processor.processDue(clock.instant())
        assertEquals("PRO", plan(shopId))
        assertEquals(
            "ACTIVE",
            jdbc.queryForObject("SELECT state FROM subscriptions WHERE shop_id = ?", String::class.java, shopId),
        )
        assertEquals(
            "revoke_unconfirmed",
            jdbc.queryForObject("SELECT outcome FROM webhook_events WHERE event_id = ?", String::class.java, id),
        )
    }

    private fun report(
        providerId: String,
        status: String = "DELIVERED",
    ) = """{"providerMessageId":"$providerId","status":"$status","occurredAt":"${clock.instant().truncatedTo(ChronoUnit.SECONDS)}"}"""

    private fun allowedClient() = "198.51.100.${1 + random.nextInt(254)}"

    @Suppress("LongParameterList")
    private fun dlr(
        body: String,
        timestamp: String? = clock.instant().epochSecond.toString(),
        signature: String? = timestamp?.let { "v1=" + DlrSignatureVerifier.sign(ATTACK_DLR_SECRET, it, body.toByteArray()) },
        peer: String = RawHttp.TRUSTED_PROXY,
        client: String? = allowedClient(),
    ): RawHttp.Response {
        val headers = mutableMapOf("Content-Type" to "application/json")
        timestamp?.let { headers["X-Cetele-Timestamp"] = it }
        signature?.let { headers["X-Cetele-Signature"] = it }
        return http.exchange("POST", "/v1/webhooks/sms-dlr", headers, body.toByteArray(), peer, client)
    }

    private fun reports(providerId: String): Int =
        jdbc.queryForObject("SELECT count(*) FROM sms_delivery_reports WHERE provider_msg_id = ?", Int::class.java, providerId)!!

    @Test
    fun `control - a signed report from the allowlisted provider is accepted`() {
        val id = "dlr-" + UUID.randomUUID()
        assertEquals(200, dlr(report(id)).status)
        assertEquals(1, reports(id))
    }

    @Test
    fun `a spoofed allowlisted address is refused`() {
        val id = "dlr-" + UUID.randomUUID()
        val body = report(id)
        assertProblem(dlr(body, peer = UNTRUSTED_DLR, client = allowedClient()), 401, "webhook.unauthenticated", "untrusted peer")
        assertProblem(dlr(body, client = "192.0.2.10"), 401, "webhook.unauthenticated", "client outside the allowlist")
        assertProblem(dlr(body, client = "192.0.2.10, ${allowedClient()}, 192.0.2.10"), 401, "webhook.unauthenticated", "allowlisted hop")
        assertEquals(0, reports(id))
    }

    @Test
    fun `forged delivery report signatures are refused`() {
        val id = "dlr-" + UUID.randomUUID()
        val body = report(id, "UNDELIVERED")
        val now = clock.instant().epochSecond
        val genuine = DlrSignatureVerifier.sign(ATTACK_DLR_SECRET, now.toString(), body.toByteArray())
        val other = report("dlr-" + UUID.randomUUID())
        val forged =
            listOf(
                Triple("unsigned", now.toString(), null),
                Triple("no timestamp", null, "v1=$genuine"),
                Triple("zero signature", now.toString(), "v1=" + "0".repeat(64)),
                Triple("uppercase hex", now.toString(), "v1=" + genuine.uppercase()),
                Triple("another scheme", now.toString(), "sha256=$genuine"),
                Triple(
                    "wrong secret",
                    now.toString(),
                    "v1=" + DlrSignatureVerifier.sign("guessed-secret-of-at-least-32-bytes!!", now.toString(), body.toByteArray()),
                ),
                Triple(
                    "signature of another body",
                    now.toString(),
                    "v1=" + DlrSignatureVerifier.sign(ATTACK_DLR_SECRET, now.toString(), other.toByteArray()),
                ),
                Triple("timestamp moved after signing", (now + 1).toString(), "v1=$genuine"),
                Triple(
                    "stale but signed",
                    (now - 400).toString(),
                    "v1=" + DlrSignatureVerifier.sign(ATTACK_DLR_SECRET, (now - 400).toString(), body.toByteArray()),
                ),
                Triple(
                    "future but signed",
                    (now + 400).toString(),
                    "v1=" + DlrSignatureVerifier.sign(ATTACK_DLR_SECRET, (now + 400).toString(), body.toByteArray()),
                ),
            )
        forged.forEach { (name, timestamp, signature) ->
            assertProblem(dlr(body, timestamp = timestamp, signature = signature), 401, "webhook.unauthenticated", name)
        }
        assertEquals(0, reports(id))
    }

    @Test
    fun `a replayed delivery report is applied once and a later conflicting report changes nothing`() {
        val id = "dlr-" + UUID.randomUUID()
        val body = report(id)
        val timestamp = clock.instant().epochSecond.toString()
        repeat(3) { assertEquals(200, dlr(body, timestamp = timestamp).status) }
        assertEquals(200, dlr(report(id, "UNDELIVERED")).status)
        assertEquals(1, reports(id))
        assertEquals(
            "DELIVERED",
            jdbc.queryForObject("SELECT status FROM sms_delivery_reports WHERE provider_msg_id = ?", String::class.java, id),
        )
    }

    private fun hs256(audience: String): String {
        val now = clock.instant()
        val claims =
            JWTClaimsSet
                .Builder()
                .issuer("https://accounts.google.com")
                .audience(audience)
                .claim("email", LocalRtdnSigner.EMAIL)
                .claim("email_verified", true)
                .issueTime(java.util.Date.from(now))
                .expirationTime(java.util.Date.from(now.plus(Duration.ofHours(1))))
                .build()
        return SignedJWT(JWSHeader.Builder(JWSAlgorithm.HS256).keyID(LocalRtdnSigner.KID).build(), claims)
            .apply { sign(MACSigner(ByteArray(32).also(random::nextBytes))) }
            .serialize()
    }

    private fun b64(json: String): String = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.UTF_8))
}
