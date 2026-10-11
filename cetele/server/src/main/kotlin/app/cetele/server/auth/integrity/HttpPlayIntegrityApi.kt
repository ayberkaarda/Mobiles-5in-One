package app.cetele.server.auth.integrity

import app.cetele.server.billing.play.GoogleServiceAccountTokens
import app.cetele.server.billing.play.GoogleTokenUnavailable
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper

/**
 * The real Play Integrity adapter (`CETELE_INTEGRITY_MODE=play`, ADR-0006):
 * `POST https://playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken` with the body
 * `{"integrity_token": "..."}` and a service account access token for the `playintegrity` scope from
 * billing's [GoogleServiceAccountTokens]. [rest] carries the base URL and the timeouts (5 s connect,
 * 10 s read); nothing is retried inside a call. 400 means "not a valid token"; every other failure,
 * including 401/403 from Google and a missing access token, is "unavailable". The token is sent only
 * in the request body and is never logged.
 *
 * Request and response shapes follow Google's public documentation and are not verified against the
 * live API (`not exercised: no Play Console account`).
 */
class HttpPlayIntegrityApi(
    private val rest: RestClient,
    private val packageName: String,
    private val tokens: GoogleServiceAccountTokens,
    private val mapper: ObjectMapper,
) : PlayIntegrityApi {
    override fun decodeIntegrityToken(token: String): IntegrityDecodeResult {
        val bearer =
            try {
                tokens.accessToken()
            } catch (failure: GoogleTokenUnavailable) {
                return IntegrityDecodeResult.Unavailable(failure.message ?: "token")
            }
        val body = mapper.writeValueAsString(mapOf("integrity_token" to token))
        return try {
            rest
                .post()
                .uri(DECODE_PATH, packageName)
                .header("Authorization", "Bearer $bearer")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .body(body)
                .exchange { _, response ->
                    val status = response.statusCode
                    when {
                        status.is2xxSuccessful -> parse(response.body.readAllBytes())
                        status.value() == INVALID_TOKEN_STATUS -> IntegrityDecodeResult.Invalid
                        else -> IntegrityDecodeResult.Unavailable("http_${status.value()}")
                    }
                }
        } catch (exception: RestClientException) {
            IntegrityDecodeResult.Unavailable("transport")
        }
    }

    private fun parse(bytes: ByteArray): IntegrityDecodeResult {
        val root = runCatching { mapper.readTree(bytes) }.getOrNull()
        val payload = root?.path("tokenPayloadExternal")
        if (payload == null || !payload.isObject) return IntegrityDecodeResult.Unavailable("unparseable")
        val request = payload.path("requestDetails")
        val app = payload.path("appIntegrity")
        val device = payload.path("deviceIntegrity").path("deviceRecognitionVerdict")
        return IntegrityDecodeResult.Decoded(
            IntegrityTokenPayload(
                requestPackageName = text(request, "requestPackageName"),
                nonce = text(request, "nonce"),
                requestHash = text(request, "requestHash"),
                timestampMillis = millis(request.path("timestampMillis")),
                appRecognitionVerdict = text(app, "appRecognitionVerdict"),
                appPackageName = text(app, "packageName"),
                deviceRecognitionVerdict =
                    if (device.isArray) device.mapNotNull { it.takeIf { node -> node.isString }?.asString() }.toSet() else emptySet(),
            ),
        )
    }

    /** `timestampMillis` is an int64, which proto3 JSON writes as a string; a number is accepted too. */
    private fun millis(node: JsonNode): Long? =
        when {
            node.isIntegralNumber -> node.asLong()
            node.isString -> node.asString().toLongOrNull()
            else -> null
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
        const val BASE_URL = "https://playintegrity.googleapis.com"
        const val DECODE_PATH = "/v1/{packageName}:decodeIntegrityToken"
        const val SCOPE = "https://www.googleapis.com/auth/playintegrity"
        private const val INVALID_TOKEN_STATUS = 400
    }
}
