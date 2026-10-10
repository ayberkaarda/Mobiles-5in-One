package app.cetele.server.billing.play

import com.nimbusds.jose.crypto.RSASSAVerifier
import com.nimbusds.jwt.SignedJWT
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.ExpectedCount
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.content
import org.springframework.test.web.client.match.MockRestRequestMatchers.header
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withException
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import tools.jackson.databind.json.JsonMapper
import java.net.SocketTimeoutException
import java.net.URLDecoder
import java.security.KeyPairGenerator
import java.security.interfaces.RSAPublicKey
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The real Play adapter against a mocked HTTP server. Every fixture below is a shape per provider
 * documentation, not verified against the live API (`not exercised: no Play Console account`).
 */
class HttpPlayDeveloperApiTest {
    private val mapper = JsonMapper.builder().build()
    private val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    private val clock = Clock.fixed(Instant.parse("2026-10-11T09:30:00Z"), ZoneOffset.UTC)
    private val builder = RestClient.builder().baseUrl(HttpPlayDeveloperApi.BASE_URL)
    private val server = MockRestServiceServer.bindTo(builder).build()
    private val rest = builder.build()
    private val key = ServiceAccountKey.parse(serviceAccountJson(), mapper)
    private val tokens = GoogleServiceAccountTokens(key, GoogleServiceAccountTokens.ANDROID_PUBLISHER_SCOPE, rest, mapper, clock)
    private val api = HttpPlayDeveloperApi(rest, PACKAGE, tokens, mapper)

    private fun serviceAccountJson(): String {
        val pem =
            "-----BEGIN PRIVATE KEY-----\\n" +
                Base64
                    .getEncoder()
                    .encodeToString(keys.private.encoded)
                    .chunked(64)
                    .joinToString("\\n") +
                "\\n-----END PRIVATE KEY-----\\n"
        return """{"type":"service_account","client_email":"$EMAIL","private_key":"$pem","token_uri":"$TOKEN_URI"}"""
    }

    private fun expectTokenExchange(count: ExpectedCount = ExpectedCount.once()) {
        server
            .expect(count, requestTo(TOKEN_URI))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_FORM_URLENCODED))
            .andExpect { request ->
                val form =
                    (request as org.springframework.mock.http.client.MockClientHttpRequest)
                        .bodyAsString
                        .split('&')
                        .associate { part -> part.substringBefore('=') to URLDecoder.decode(part.substringAfter('='), Charsets.UTF_8) }
                assertEquals(GoogleServiceAccountTokens.GRANT_TYPE, form["grant_type"])
                val assertion = SignedJWT.parse(form["assertion"])
                assertTrue(assertion.verify(RSASSAVerifier(keys.public as RSAPublicKey)))
                assertEquals("RS256", assertion.header.algorithm.name)
                assertEquals(EMAIL, assertion.jwtClaimsSet.issuer)
                assertEquals(listOf(TOKEN_URI), assertion.jwtClaimsSet.audience)
                assertEquals(GoogleServiceAccountTokens.ANDROID_PUBLISHER_SCOPE, assertion.jwtClaimsSet.getStringClaim("scope"))
                assertEquals(clock.instant(), assertion.jwtClaimsSet.issueTime.toInstant())
                assertEquals(clock.instant().plusSeconds(3600), assertion.jwtClaimsSet.expirationTime.toInstant())
            }.andRespond(
                withSuccess("""{"access_token":"ya29.test-access","expires_in":3599,"token_type":"Bearer"}""", MediaType.APPLICATION_JSON),
            )
    }

    private fun subscriptionUrl(token: String) =
        "${HttpPlayDeveloperApi.BASE_URL}/androidpublisher/v3/applications/$PACKAGE/purchases/subscriptionsv2/tokens/$token"

    @Test
    fun `subscriptionsv2 get is parsed into the port model`() {
        expectTokenExchange()
        server
            .expect(requestTo(subscriptionUrl(TOKEN)))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header("Authorization", "Bearer ya29.test-access"))
            .andRespond(withSuccess(SUBSCRIPTION_FIXTURE, MediaType.APPLICATION_JSON))
        val purchase = assertIs<PlaySubscriptionResult.Found>(api.getSubscription(TOKEN)).purchase
        assertEquals(PlaySubscriptionPurchase.STATE_ACTIVE, purchase.subscriptionState)
        assertTrue(purchase.acknowledgementPending)
        assertEquals("previous.token-1", purchase.linkedPurchaseToken)
        assertEquals("775ddbc0c97c6683bb78cafdffea51471b53ceb7fbd89993ed36e130430db621", purchase.obfuscatedExternalAccountId)
        assertTrue(purchase.testPurchase)
        val item = purchase.lineItemFor("cetele_pro")!!
        assertEquals(Instant.parse("2026-11-11T09:30:00.123Z"), item.expiryTime)
        assertEquals("yearly", item.basePlanId)
        assertTrue(item.autoRenewEnabled)
        assertNull(purchase.lineItemFor("cetele_other_product"))
        assertTrue(!purchase.toString().contains("previous.token-1"))
        server.verify()
    }

    @Test
    fun `access token is cached until a minute before expiry`() {
        expectTokenExchange()
        repeat(2) {
            server.expect(requestTo(subscriptionUrl(TOKEN))).andRespond(withSuccess(MINIMAL_FIXTURE, MediaType.APPLICATION_JSON))
        }
        assertIs<PlaySubscriptionResult.Found>(api.getSubscription(TOKEN))
        val found = assertIs<PlaySubscriptionResult.Found>(api.getSubscription(TOKEN)).purchase
        assertTrue(!found.testPurchase)
        assertEquals("ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED", found.acknowledgementState)
        assertNull(found.obfuscatedExternalAccountId)
        server.verify()
    }

    @Test
    fun `not found statuses and failures map to the port results`() {
        expectTokenExchange()
        listOf(400, 404, 410).forEach { status ->
            server.expect(requestTo(subscriptionUrl(TOKEN))).andRespond(withStatus(HttpStatus.valueOf(status)))
        }
        listOf(401, 403, 429, 500, 503).forEach { status ->
            server.expect(requestTo(subscriptionUrl(TOKEN))).andRespond(withStatus(HttpStatus.valueOf(status)))
        }
        server.expect(requestTo(subscriptionUrl(TOKEN))).andRespond(withException(SocketTimeoutException("read timed out")))
        server.expect(requestTo(subscriptionUrl(TOKEN))).andRespond(withSuccess("not json", MediaType.APPLICATION_JSON))
        repeat(3) { assertEquals(PlaySubscriptionResult.NotFound, api.getSubscription(TOKEN)) }
        listOf(401, 403, 429, 500, 503).forEach { status ->
            assertEquals(PlaySubscriptionResult.Unavailable("http_$status"), api.getSubscription(TOKEN))
        }
        assertEquals(PlaySubscriptionResult.Unavailable("transport"), api.getSubscription(TOKEN))
        assertEquals(PlaySubscriptionResult.Unavailable("unparseable"), api.getSubscription(TOKEN))
        server.verify()
    }

    @Test
    fun `acknowledge posts to the documented path`() {
        expectTokenExchange()
        val url =
            "${HttpPlayDeveloperApi.BASE_URL}/androidpublisher/v3/applications/$PACKAGE/purchases/subscriptions/cetele_pro/tokens/$TOKEN:acknowledge"
        server
            .expect(requestTo(url))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("Authorization", "Bearer ya29.test-access"))
            .andExpect(content().json("{}"))
            .andRespond(withSuccess())
        server.expect(requestTo(url)).andRespond(withStatus(HttpStatus.GONE))
        server.expect(requestTo(url)).andRespond(withStatus(HttpStatus.BAD_GATEWAY))
        assertEquals(PlayAckResult.Acknowledged, api.acknowledge("cetele_pro", TOKEN))
        assertEquals(PlayAckResult.NotFound, api.acknowledge("cetele_pro", TOKEN))
        assertEquals(PlayAckResult.Unavailable("http_502"), api.acknowledge("cetele_pro", TOKEN))
        server.verify()
    }

    @Test
    fun `a failed token exchange makes play unavailable without calling it`() {
        server.expect(requestTo(TOKEN_URI)).andRespond(withStatus(HttpStatus.BAD_REQUEST))
        server.expect(requestTo(TOKEN_URI)).andRespond(withSuccess("""{"token_type":"Bearer"}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo(TOKEN_URI)).andRespond(withException(SocketTimeoutException("connect timed out")))
        assertEquals(PlaySubscriptionResult.Unavailable("token_http_400"), api.getSubscription(TOKEN))
        assertEquals(PlaySubscriptionResult.Unavailable("token_missing"), api.getSubscription(TOKEN))
        assertEquals(PlayAckResult.Unavailable("token_transport"), api.acknowledge("cetele_pro", TOKEN))
        server.verify()
    }

    @Test
    fun `service account keys are validated without echoing them`() {
        val secret = Base64.getEncoder().encodeToString(keys.private.encoded).take(40)
        listOf(
            "not json",
            """{"client_email":"$EMAIL","token_uri":"$TOKEN_URI"}""",
            """{"client_email":"$EMAIL","private_key":"-----BEGIN PRIVATE KEY-----\n$secret\n-----END PRIVATE KEY-----","token_uri":"$TOKEN_URI"}""",
            serviceAccountJson().replace(TOKEN_URI, "http://oauth2.googleapis.com/token"),
        ).forEach { json ->
            val failure = assertFailsWith<IllegalStateException> { ServiceAccountKey.parse(json, mapper) }
            assertEquals("CETELE_PLAY_SERVICE_ACCOUNT_JSON is not a service account key", failure.message)
        }
        assertEquals("ServiceAccountKey(clientEmail=$EMAIL)", key.toString())
    }

    companion object {
        const val PACKAGE = "app.cetele.android"
        const val EMAIL = "play-billing@cetele-test.iam.gserviceaccount.com"
        const val TOKEN_URI = "https://oauth2.googleapis.com/token"
        const val TOKEN = "opaque.purchase-token_123"

        /** Shape per provider documentation, not verified against the live API. */
        val SUBSCRIPTION_FIXTURE =
            """
            {
              "kind": "androidpublisher#subscriptionPurchaseV2",
              "regionCode": "TR",
              "startTime": "2026-10-11T09:30:00.123Z",
              "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
              "latestOrderId": "GPA.3301-1234-5678-90123",
              "linkedPurchaseToken": "previous.token-1",
              "acknowledgementState": "ACKNOWLEDGEMENT_STATE_PENDING",
              "externalAccountIdentifiers": {
                "obfuscatedExternalAccountId": "775ddbc0c97c6683bb78cafdffea51471b53ceb7fbd89993ed36e130430db621"
              },
              "testPurchase": {},
              "lineItems": [
                {
                  "productId": "cetele_pro",
                  "expiryTime": "2026-11-11T09:30:00.123Z",
                  "autoRenewingPlan": { "autoRenewEnabled": true },
                  "offerDetails": { "basePlanId": "yearly", "offerTags": [] }
                },
                {
                  "productId": "cetele_pro",
                  "expiryTime": "2026-10-20T09:30:00Z",
                  "offerDetails": { "basePlanId": "monthly" }
                }
              ]
            }
            """.trimIndent()

        /** Shape per provider documentation, not verified against the live API. */
        val MINIMAL_FIXTURE =
            """
            {
              "subscriptionState": "SUBSCRIPTION_STATE_ON_HOLD",
              "acknowledgementState": "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
              "lineItems": [{ "productId": "cetele_pro", "expiryTime": "2026-10-10T09:30:00Z" }]
            }
            """.trimIndent()
    }
}
