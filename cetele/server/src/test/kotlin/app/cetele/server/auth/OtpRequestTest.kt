package app.cetele.server.auth

import app.cetele.server.auth.integrity.FakeIntegrityVerifier
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import tools.jackson.databind.ObjectMapper
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class OtpRequestTest(
    @Autowired mvc: MockMvc,
    @Autowired private val json: ObjectMapper,
    @Autowired sms: SmsGateway,
    @Autowired private val auth: TestAuth,
) {
    private val fakeSms = sms as FakeSmsGateway
    private val api = AuthApi(mvc, json, fakeSms)

    @Test
    fun `a valid request is accepted with an empty body and sends one code`() {
        val phone = TestUsers.phone()
        val response = api.requestOtp(phone, UUID.randomUUID())
        assertEquals(202, response.status)
        assertEquals("", response.contentAsString)
        assertEquals(1, fakeSms.messagesTo(phone).size)
        assertTrue(Regex("""\b\d{6}\b""").containsMatchIn(fakeSms.lastMessageTo(phone)!!.text))
    }

    @Test
    fun `the fourth request for a phone within ten minutes is 429 with Retry-After`() {
        val phone = TestUsers.phone()
        repeat(3) { assertEquals(202, api.requestOtp(phone, UUID.randomUUID(), ip = AuthApi.randomIp()).status) }
        val fourth = api.requestOtp(phone, UUID.randomUUID(), ip = AuthApi.randomIp())
        assertProblem(fourth, 429, "rate_limited")
        val retryAfter = assertNotNull(fourth.getHeader(HttpHeaders.RETRY_AFTER)).toLong()
        assertTrue(retryAfter in 1..600, "Retry-After is in whole seconds within the window")
        assertEquals(3, fakeSms.messagesTo(phone).size)
    }

    @Test
    fun `the eleventh request from one address within ten minutes is 429`() {
        repeat(10) { assertEquals(202, api.requestOtp(TestUsers.phone(), UUID.randomUUID()).status) }
        val eleventh = api.requestOtp(TestUsers.phone(), UUID.randomUUID())
        assertProblem(eleventh, 429, "rate_limited")
        assertNotNull(eleventh.getHeader(HttpHeaders.RETRY_AFTER))
    }

    @Test
    fun `a missing integrity token is 403 integrity_required and sends nothing`() {
        val phone = TestUsers.phone()
        assertProblem(api.requestOtp(phone, UUID.randomUUID(), integrityToken = null), 403, "auth.integrity_required")
        assertProblem(api.requestOtp(phone, UUID.randomUUID(), integrityToken = "  "), 403, "auth.integrity_required")
        assertNull(fakeSms.lastMessageTo(phone))
    }

    @Test
    fun `refused verdicts and unknown tokens are 403 integrity_invalid`() {
        val phone = TestUsers.phone()
        listOf(
            FakeIntegrityVerifier.UNRECOGNIZED_APP,
            FakeIntegrityVerifier.NO_DEVICE_INTEGRITY,
            FakeIntegrityVerifier.PACKAGE_MISMATCH,
            "fake.OK",
            "fake.ok ",
            "not-a-token",
        ).forEach { token ->
            assertProblem(api.requestOtp(phone, UUID.randomUUID(), integrityToken = token), 403, "auth.integrity_invalid")
        }
        assertNull(fakeSms.lastMessageTo(phone))
    }

    @Test
    fun `requests without a valid verdict do not use up the phone budget`() {
        val phone = TestUsers.phone()
        repeat(
            5,
        ) { api.requestOtp(phone, UUID.randomUUID(), integrityToken = FakeIntegrityVerifier.UNRECOGNIZED_APP, ip = AuthApi.randomIp()) }
        assertEquals(202, api.requestOtp(phone, UUID.randomUUID(), ip = AuthApi.randomIp()).status)
    }

    @Test
    fun `the response for an unknown phone is identical to the one for a known phone`() {
        val known = TestUsers.phone()
        auth.user(known)
        val unknown = TestUsers.phone()
        val forKnown = api.requestOtp(known, UUID.randomUUID(), ip = AuthApi.randomIp())
        val forUnknown = api.requestOtp(unknown, UUID.randomUUID(), ip = AuthApi.randomIp())
        assertEquals(forKnown.status, forUnknown.status)
        assertEquals(forKnown.contentAsString, forUnknown.contentAsString)
        val ignored = setOf("X-Trace-Id", "Content-Security-Policy")
        assertEquals(
            forKnown.headerNames.filterNot { it in ignored }.associateWith { forKnown.getHeaders(it) },
            forUnknown.headerNames.filterNot { it in ignored }.associateWith { forUnknown.getHeaders(it) },
        )
        assertNotNull(fakeSms.lastMessageTo(known))
        assertNotNull(fakeSms.lastMessageTo(unknown))
    }

    @Test
    fun `malformed input is 422 with field codes only`() {
        val response = api.requestOtp("05551234567", UUID.randomUUID())
        assertProblem(response, 422, "validation.failed")
        val body = json.readTree(response.contentAsString)
        assertEquals("phone", body["errors"][0]["field"].asString())
        assertEquals("invalid_format", body["errors"][0]["code"].asString())
        assertTrue(!response.contentAsString.contains("0555"), "submitted values are never echoed")
    }

    private fun assertProblem(
        response: MockHttpServletResponse,
        status: Int,
        code: String,
    ) {
        assertEquals(status, response.status)
        assertEquals(code, json.readTree(response.contentAsString)["code"].asString())
    }
}
