package app.cetele.server.auth

import app.cetele.server.auth.integrity.FakeIntegrityVerifier
import app.cetele.server.auth.sms.FakeSmsGateway
import org.springframework.http.MediaType
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.security.SecureRandom
import java.util.UUID

/**
 * Drives the sign-in endpoints through MockMvc. Every instance uses its own client address, so the
 * per-IP buckets of one test never leak into another test sharing the application context.
 */
class AuthApi(
    private val mvc: MockMvc,
    private val json: ObjectMapper,
    private val sms: FakeSmsGateway,
    val ip: String = randomIp(),
) {
    fun requestOtp(
        phone: String,
        deviceId: UUID,
        integrityToken: String? = FakeIntegrityVerifier.OK,
        ip: String = this.ip,
    ): MockHttpServletResponse {
        val body = mutableMapOf<String, Any>("phone" to phone, "deviceId" to deviceId.toString())
        if (integrityToken != null) body["integrityToken"] = integrityToken
        return post("/v1/auth/otp/request", body, ip)
    }

    fun verifyOtp(
        phone: String,
        deviceId: UUID,
        code: String,
        ip: String = this.ip,
    ): MockHttpServletResponse =
        post(
            "/v1/auth/otp/verify",
            mapOf("phone" to phone, "deviceId" to deviceId.toString(), "code" to code, "model" to "Pixel 8", "appVersion" to "1.0.0"),
            ip,
        )

    fun refresh(
        refreshToken: String,
        ip: String = this.ip,
    ): MockHttpServletResponse = post("/v1/auth/refresh", mapOf("refreshToken" to refreshToken), ip)

    /** The code of the newest message the fake gateway holds for [phone]. */
    fun lastCode(phone: String): String {
        val text = sms.lastMessageTo(phone)?.text ?: error("no SMS for this phone")
        return CODE.find(text)?.value ?: error("no code in the SMS")
    }

    /** Requests a code and signs in with it; returns the verify response body. */
    fun signIn(
        phone: String,
        deviceId: UUID = UUID.randomUUID(),
    ): JsonNode {
        val requested = requestOtp(phone, deviceId)
        check(requested.status == 202) { "otp request failed with ${requested.status}" }
        val verified = verifyOtp(phone, deviceId, lastCode(phone))
        check(verified.status == 200) { "otp verify failed with ${verified.status}" }
        return json.readTree(verified.contentAsString)
    }

    fun read(response: MockHttpServletResponse): JsonNode = json.readTree(response.contentAsString)

    private fun post(
        path: String,
        body: Any,
        ip: String,
    ): MockHttpServletResponse =
        mvc
            .post(path) {
                contentType = MediaType.APPLICATION_JSON
                content = json.writeValueAsString(body)
                with { request ->
                    request.remoteAddr = ip
                    request
                }
            }.andReturn()
            .response

    companion object {
        private val CODE = Regex("""\b\d{6}\b""")
        private val random = SecureRandom()

        /** A client address in 10.0.0.0/8, random per call. */
        fun randomIp(): String = "10." + (1..3).joinToString(".") { random.nextInt(256).toString() }

        /** Six digits other than [code]. */
        fun otherCode(code: String): String = ((code.toInt() + 1) % 1_000_000).toString().padStart(6, '0')
    }
}
