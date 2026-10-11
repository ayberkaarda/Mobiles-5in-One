package app.cetele.server.billing.webhook

import app.cetele.server.billing.BillingTestSupport
import app.cetele.server.billing.PurchaseTokens
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import app.cetele.server.tenancy.TenancyFixtures.Companion.withoutTraceId
import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.MACSigner
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import org.junit.jupiter.api.Test
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.post
import java.time.Duration
import java.util.Base64
import java.util.Date
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `POST /v1/webhooks/play-rtdn` (ADR-0032). Push tokens are signed with the local RSA key of the
 * `fake-rtdn-signer`; no Google-signed token was ever checked (`not exercised: no Google Cloud project`).
 */
@IntegrationTest
class PlayRtdnWebhookTest : BillingTestSupport() {
    private fun body(): String = envelope(subscriptionNotification(token("active", UUID.randomUUID()), 4))

    private fun unauthenticated(bearer: String?): String = push(body(), bearer).expectProblem(401, "webhook.unauthenticated")

    @Test
    fun `missing bearer is 401`() {
        unauthenticated(null)
        unauthenticated("Basic dXNlcjpwYXNz")
        unauthenticated("Bearer ")
        unauthenticated("bearer " + signer.sign(expectations.audience))
        unauthenticated("Bearer " + "a".repeat(4097))
        unauthenticated("Bearer not-a-jwt")
    }

    @Test
    fun `alg none and hs256 are 401`() {
        val header =
            Base64.getUrlEncoder().withoutPadding().encodeToString(
                """{"alg":"none","typ":"JWT","kid":"local-rtdn-1"}""".toByteArray(),
            )
        val payload = Base64.getUrlEncoder().withoutPadding().encodeToString(claims().toString().toByteArray())
        unauthenticated("Bearer $header.$payload.")
        val hs = SignedJWT(JWSHeader.Builder(JWSAlgorithm.HS256).keyID(LocalRtdnSigner.KID).build(), claims())
        hs.sign(MACSigner(ByteArray(32) { 7 }))
        unauthenticated("Bearer " + hs.serialize())
        val rs512 =
            SignedJWT(
                JWSHeader
                    .Builder(JWSAlgorithm.RS512)
                    .keyID(LocalRtdnSigner.KID)
                    .type(JOSEObjectType.JWT)
                    .build(),
                claims(),
            )
        rs512.sign(
            com.nimbusds.jose.crypto
                .RSASSASigner(signer.key),
        )
        unauthenticated("Bearer " + rs512.serialize())
    }

    @Test
    fun `unknown kid is 401`() {
        val stranger = RSAKeyGenerator(2048).keyID("other-1").generate()
        unauthenticated("Bearer " + signer.sign(expectations.audience, signingKey = stranger))
        // The right kid with another key fails the signature check.
        val impostor = RSAKeyGenerator(2048).keyID(LocalRtdnSigner.KID).generate()
        unauthenticated("Bearer " + signer.sign(expectations.audience, signingKey = impostor))
        val noKid = SignedJWT(JWSHeader.Builder(JWSAlgorithm.RS256).build(), claims())
        noKid.sign(
            com.nimbusds.jose.crypto
                .RSASSASigner(signer.key),
        )
        unauthenticated("Bearer " + noKid.serialize())
    }

    @Test
    fun `wrong issuer audience or email is 401`() {
        unauthenticated("Bearer " + signer.sign(expectations.audience, issuer = "https://evil.example"))
        unauthenticated("Bearer " + signer.sign(expectations.audience + "/other"))
        unauthenticated("Bearer " + signer.sign("https://cetele.app/v1/webhooks/play-rtdn"))
        unauthenticated("Bearer " + signer.sign(expectations.audience, email = "someone@cetele.invalid"))
        val twoAudiences =
            SignedJWT(
                JWSHeader.Builder(JWSAlgorithm.RS256).keyID(LocalRtdnSigner.KID).build(),
                JWTClaimsSet.Builder(claims()).audience(listOf(expectations.audience, "https://other.example")).build(),
            )
        twoAudiences.sign(
            com.nimbusds.jose.crypto
                .RSASSASigner(signer.key),
        )
        unauthenticated("Bearer " + twoAudiences.serialize())
        // Both documented issuer spellings are accepted.
        pushOk(body())
        push(body(), "Bearer " + signer.sign(expectations.audience, issuer = "accounts.google.com")).andExpect { status { isOk() } }
    }

    @Test
    fun `unverified email is 401`() {
        unauthenticated("Bearer " + signer.sign(expectations.audience, emailVerified = false))
        unauthenticated("Bearer " + signer.sign(expectations.audience, emailVerified = "true"))
        unauthenticated("Bearer " + signer.sign(expectations.audience, emailVerified = null))
    }

    @Test
    fun `expired token is 401`() {
        val now = clock.instant()
        unauthenticated(
            "Bearer " + signer.sign(expectations.audience, issuedAt = now.minus(Duration.ofHours(2)), expiresAt = now.minusSeconds(31)),
        )
        unauthenticated("Bearer " + signer.sign(expectations.audience, issuedAt = now.plusSeconds(120), expiresAt = now.plusSeconds(3600)))
        // Inside the 30-second leeway the token still counts.
        push(body(), "Bearer " + signer.sign(expectations.audience, issuedAt = now.minusSeconds(3600), expiresAt = now.minusSeconds(10)))
            .andExpect { status { isOk() } }
    }

    @Test
    fun `valid push is stored and answered 200`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        val messageId = "1369693469" + suffix()
        pushOk(envelope(subscriptionNotification(token, 2), messageId))
        val row = event(messageId)
        assertEquals("PLAY_RTDN", row["provider"])
        assertEquals("RECEIVED", row["status"])
        assertEquals(2, row["notification_type"])
        assertEquals(PurchaseTokens.hash(token), row["purchase_token_hash"])
        assertNotNull(row["purchase_token_enc"])
        assertNotNull(row["published_at"])
        processor.processDue(clock.instant())
        val done = event(messageId)
        assertEquals("PROCESSED", done["status"])
        assertEquals("verified", done["outcome"])
        assertNull(done["purchase_token_enc"])
        assertNotNull(done["processed_at"])
        assertEquals(2, row(token)["last_notification_type"])
    }

    @Test
    fun `replayed message id is 200 and stored once`() {
        val world = world()
        val token = token("active", world.shopId)
        linkOk(world.shopId, token, world.owner)
        val messageId = "replay-" + suffix()
        val body = envelope(subscriptionNotification(token, 2), messageId)
        pushOk(body)
        pushOk(body)
        processor.processDue(clock.instant())
        pushOk(body)
        assertEquals(1, events(messageId))
        assertEquals("PROCESSED", event(messageId)["status"])
        // A message id in the snake-case spelling is the same key.
        pushOk(body.replace("\"messageId\"", "\"message_id\""))
        assertEquals(1, events(messageId))
    }

    @Test
    fun `malformed envelope after a valid token is 200 and not stored`() {
        val id = "malformed-" + suffix()
        val valid = subscriptionNotification(token("active", UUID.randomUUID()), 4)
        listOf(
            "not json",
            "[]",
            """{"subscription":"x"}""",
            """{"message":{"data":"${Base64.getEncoder().encodeToString(valid.toByteArray())}"}}""",
            """{"message":{"data":"${Base64.getEncoder().encodeToString(valid.toByteArray())}","messageId":"${"9".repeat(129)}"}}""",
            """{"message":{"data":"%%%","messageId":"$id"}}""",
            """{"message":{"data":"${Base64.getEncoder().encodeToString("not json".toByteArray())}","messageId":"$id"}}""",
            envelope("""{"packageName":"$PACKAGE","subscriptionNotification":{"notificationType":4}}""", id),
            envelope("""{"packageName":"$PACKAGE","subscriptionNotification":{"notificationType":4,"purchaseToken":"bad token"}}""", id),
        ).forEach { pushOk(it) }
        assertEquals(0, events(id))
        assertEquals(0, events("9".repeat(129)))
    }

    @Test
    fun `oversize body is 413`() {
        val padding = "x".repeat(PlayRtdnWebhook.MAX_BODY_BYTES)
        val oversize = """{"message":{"data":"","messageId":"big"},"padding":"$padding"}"""
        push(oversize).expectProblem(413, "payload_too_large")
        // The cap is checked before the token: an anonymous flood of large bodies never reaches verification.
        push(oversize, null).expectProblem(413, "payload_too_large")
        assertEquals(0, events("big"))
        // Exactly at the cap is read and handled.
        val atCap = "{\"p\":\"" + "x".repeat(PlayRtdnWebhook.MAX_BODY_BYTES - 8) + "\"}"
        assertEquals(PlayRtdnWebhook.MAX_BODY_BYTES, atCap.length)
        pushOk(atCap)
    }

    @Test
    fun `failure bodies are identical`() {
        val bodies =
            listOf(
                unauthenticated(null),
                unauthenticated("Bearer not-a-jwt"),
                unauthenticated("Bearer " + signer.sign(expectations.audience, issuer = "https://evil.example")),
                unauthenticated("Bearer " + signer.sign("https://wrong.example")),
                unauthenticated("Bearer " + signer.sign(expectations.audience, email = "x@cetele.invalid")),
                unauthenticated("Bearer " + signer.sign(expectations.audience, emailVerified = false)),
                unauthenticated(
                    "Bearer " +
                        signer.sign(
                            expectations.audience,
                            issuedAt = clock.instant().minusSeconds(7200),
                            expiresAt = clock.instant().minusSeconds(60),
                        ),
                ),
                unauthenticated("Bearer " + signer.sign(expectations.audience, signingKey = RSAKeyGenerator(2048).keyID("x").generate())),
            ).map { withoutTraceId(it) }
        assertTrue(bodies.all { it == bodies.first() }, bodies.toString())
        assertEquals(setOf("type", "title", "status", "code"), bodies.first().keys)
    }

    @Test
    fun `rate bucket is charged before the token check`() {
        val address = "203.0.113." + (1..250).random()
        repeat(600) {
            mvc
                .post(RtdnExpectations.PATH) {
                    with { request -> request.apply { remoteAddr = address } }
                    contentType = MediaType.APPLICATION_JSON
                    content = "{}"
                }.andExpect { status { isUnauthorized() } }
        }
        mvc
            .post(RtdnExpectations.PATH) {
                with { request -> request.apply { remoteAddr = address } }
                header("Authorization", "Bearer " + signer.sign(expectations.audience))
                contentType = MediaType.APPLICATION_JSON
                content = body()
            }.expectProblem(429, "rate_limited")
    }

    private fun claims(): JWTClaimsSet =
        JWTClaimsSet
            .Builder()
            .issuer("https://accounts.google.com")
            .audience(expectations.audience)
            .claim("email", LocalRtdnSigner.EMAIL)
            .claim("email_verified", true)
            .issueTime(Date.from(clock.instant()))
            .expirationTime(Date.from(clock.instant().plusSeconds(3600)))
            .build()
}
