package app.cetele.server.auth.integrity

import app.cetele.server.billing.play.GoogleServiceAccountTokens
import app.cetele.server.billing.play.ServiceAccountKey
import com.nimbusds.jwt.SignedJWT
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.mock.http.client.MockClientHttpRequest
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
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/**
 * The real Play Integrity adapter against a mocked HTTP server. Every fixture below is a shape per
 * Google's public documentation, NOT verified against the live API (`not exercised: no Play Console
 * account`); a real token was never decoded.
 */
class HttpPlayIntegrityApiTest {
    private val mapper = JsonMapper.builder().build()
    private val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    private val clock = Clock.fixed(Instant.parse("2026-10-11T09:30:00Z"), ZoneOffset.UTC)
    private val builder = RestClient.builder().baseUrl(HttpPlayIntegrityApi.BASE_URL)
    private val server = MockRestServiceServer.bindTo(builder).build()
    private val rest = builder.build()
    private val key = ServiceAccountKey.parse(serviceAccountJson(), mapper)
    private val tokens = GoogleServiceAccountTokens(key, HttpPlayIntegrityApi.SCOPE, rest, mapper, clock)
    private val api = HttpPlayIntegrityApi(rest, PACKAGE, tokens, mapper)

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

    private fun expectTokenExchange() {
        server
            .expect(requestTo(TOKEN_URI))
            .andExpect(method(HttpMethod.POST))
            .andExpect { request ->
                val form =
                    (request as MockClientHttpRequest)
                        .bodyAsString
                        .split('&')
                        .associate { part -> part.substringBefore('=') to URLDecoder.decode(part.substringAfter('='), Charsets.UTF_8) }
                assertEquals(GoogleServiceAccountTokens.GRANT_TYPE, form["grant_type"])
                assertEquals(HttpPlayIntegrityApi.SCOPE, SignedJWT.parse(form["assertion"]).jwtClaimsSet.getStringClaim("scope"))
            }.andRespond(
                withSuccess(
                    """{"access_token":"ya29.integrity-access","expires_in":3599,"token_type":"Bearer"}""",
                    MediaType.APPLICATION_JSON,
                ),
            )
    }

    @Test
    fun `decodeIntegrityToken posts the token in the body and parses the payload`() {
        expectTokenExchange()
        server
            .expect(requestTo(DECODE_URL))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("Authorization", "Bearer ya29.integrity-access"))
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
            .andExpect(content().json("""{"integrity_token":"$TOKEN"}""", org.springframework.test.json.JsonCompareMode.STRICT))
            .andRespond(withSuccess(PAYLOAD_FIXTURE, MediaType.APPLICATION_JSON))
        val payload = assertIs<IntegrityDecodeResult.Decoded>(api.decodeIntegrityToken(TOKEN)).payload
        assertEquals(PACKAGE, payload.requestPackageName)
        assertEquals("aGFzaC1vZi1waG9uZS1hbmQtZGV2aWNlLWZvci10ZXN0cw", payload.nonce)
        assertNull(payload.requestHash)
        assertEquals(1_791_711_000_000L, payload.timestampMillis)
        assertEquals("PLAY_RECOGNIZED", payload.appRecognitionVerdict)
        assertEquals(PACKAGE, payload.appPackageName)
        assertEquals(setOf("MEETS_DEVICE_INTEGRITY"), payload.deviceRecognitionVerdict)
        server.verify()
    }

    @Test
    fun `a sparse payload keeps absent fields empty and a numeric timestamp is read`() {
        expectTokenExchange()
        server
            .expect(requestTo(DECODE_URL))
            .andRespond(
                withSuccess(
                    """{"tokenPayloadExternal":{"requestDetails":{"requestPackageName":"$PACKAGE",""" +
                        """"requestHash":"abc","timestampMillis":1791711000000},""" +
                        """"appIntegrity":{"appRecognitionVerdict":"UNEVALUATED"},"deviceIntegrity":{}}}""",
                    MediaType.APPLICATION_JSON,
                ),
            )
        val payload = assertIs<IntegrityDecodeResult.Decoded>(api.decodeIntegrityToken(TOKEN)).payload
        assertEquals("abc", payload.requestHash)
        assertNull(payload.nonce)
        assertNull(payload.appPackageName)
        assertEquals(1_791_711_000_000L, payload.timestampMillis)
        assertEquals(emptySet(), payload.deviceRecognitionVerdict)
        server.verify()
    }

    @Test
    fun `refused tokens and failures map to the port results`() {
        expectTokenExchange()
        server.expect(requestTo(DECODE_URL)).andRespond(withStatus(HttpStatus.BAD_REQUEST))
        listOf(401, 403, 404, 429, 500, 503).forEach { status ->
            server.expect(requestTo(DECODE_URL)).andRespond(withStatus(HttpStatus.valueOf(status)))
        }
        server.expect(requestTo(DECODE_URL)).andRespond(withException(SocketTimeoutException("read timed out")))
        server.expect(requestTo(DECODE_URL)).andRespond(withSuccess("not json", MediaType.APPLICATION_JSON))
        server.expect(requestTo(DECODE_URL)).andRespond(withSuccess("""{"other":{}}""", MediaType.APPLICATION_JSON))
        assertEquals(IntegrityDecodeResult.Invalid, api.decodeIntegrityToken(TOKEN))
        listOf(401, 403, 404, 429, 500, 503).forEach { status ->
            assertEquals(IntegrityDecodeResult.Unavailable("http_$status"), api.decodeIntegrityToken(TOKEN))
        }
        assertEquals(IntegrityDecodeResult.Unavailable("transport"), api.decodeIntegrityToken(TOKEN))
        assertEquals(IntegrityDecodeResult.Unavailable("unparseable"), api.decodeIntegrityToken(TOKEN))
        assertEquals(IntegrityDecodeResult.Unavailable("unparseable"), api.decodeIntegrityToken(TOKEN))
        server.verify()
    }

    @Test
    fun `a failed token exchange is unavailable without calling google`() {
        server.expect(requestTo(TOKEN_URI)).andRespond(withStatus(HttpStatus.UNAUTHORIZED))
        assertEquals(IntegrityDecodeResult.Unavailable("token_http_401"), api.decodeIntegrityToken(TOKEN))
        server.verify()
    }

    @Test
    fun `the verifier on the http adapter fails closed when google is down`() {
        expectTokenExchange()
        server.expect(requestTo(DECODE_URL)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE))
        assertNull(PlayIntegrityVerifier(api, clock).decode(TOKEN, "aGFzaC1vZi1waG9uZS1hbmQtZGV2aWNlLWZvci10ZXN0cw"))
        server.verify()
    }

    companion object {
        const val PACKAGE = "app.cetele.android"
        const val EMAIL = "play-integrity@cetele-test.iam.gserviceaccount.com"
        const val TOKEN_URI = "https://oauth2.googleapis.com/token"
        const val TOKEN = "eyJhbGciOiJBMjU2S1ciLCJlbmMiOiJBMjU2R0NNIn0.opaque-integrity-token_123"
        const val DECODE_URL = "${HttpPlayIntegrityApi.BASE_URL}/v1/$PACKAGE:decodeIntegrityToken"

        /** Shape per Google's public documentation, NOT verified against the live API. */
        val PAYLOAD_FIXTURE =
            """
            {
              "tokenPayloadExternal": {
                "requestDetails": {
                  "requestPackageName": "$PACKAGE",
                  "timestampMillis": "1791711000000",
                  "nonce": "aGFzaC1vZi1waG9uZS1hbmQtZGV2aWNlLWZvci10ZXN0cw"
                },
                "appIntegrity": {
                  "appRecognitionVerdict": "PLAY_RECOGNIZED",
                  "packageName": "$PACKAGE",
                  "certificateSha256Digest": ["6a6a1474b5cbbb2b1aa57e0bc3"],
                  "versionCode": "42"
                },
                "deviceIntegrity": {
                  "deviceRecognitionVerdict": ["MEETS_DEVICE_INTEGRITY"]
                },
                "accountDetails": {
                  "appLicensingVerdict": "LICENSED"
                }
              }
            }
            """.trimIndent()
    }
}
