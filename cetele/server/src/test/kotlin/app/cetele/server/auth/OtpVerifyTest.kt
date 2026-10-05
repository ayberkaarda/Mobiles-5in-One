package app.cetele.server.auth

import app.cetele.server.auth.sms.FakeSmsGateway
import app.cetele.server.auth.sms.SmsGateway
import app.cetele.server.security.JwtCodec
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.node.ObjectNode
import java.sql.Timestamp
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@IntegrationTest
class OtpVerifyTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val json: ObjectMapper,
    @Autowired sms: SmsGateway,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val codec: JwtCodec,
    @Autowired private val auth: TestAuth,
) {
    private val api = AuthApi(mvc, json, sms as FakeSmsGateway)

    @Test
    fun `a correct code signs a new user in and returns the session`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        api.requestOtp(phone, device)
        val response = api.verifyOtp(phone, device, api.lastCode(phone))
        assertEquals(200, response.status)
        val body = api.read(response)
        assertEquals(
            setOf("accessToken", "expiresIn", "refreshToken", "user", "isNewUser"),
            body.propertyNames().toSet(),
        )
        assertTrue(body["isNewUser"].asBoolean())
        assertEquals(900, body["expiresIn"].asLong())
        assertEquals(43, body["refreshToken"].asString().length)
        val principal = codec.verify(body["accessToken"].asString())
        assertEquals(device, principal.deviceId)
        assertEquals(principal.userId.toString(), body["user"]["id"].asString())
        assertTrue(body["user"]["displayName"].isNull)

        val userRow = jdbc.queryForMap("SELECT id, phone_e164 FROM users WHERE id = ?", principal.userId)
        assertEquals(phone, userRow["phone_e164"])
        val deviceRow =
            jdbc.queryForMap(
                "SELECT model, app_version, integrity_verified_at, last_seen_at FROM devices WHERE user_id = ? AND device_id = ?",
                principal.userId,
                device,
            )
        assertEquals("Pixel 8", deviceRow["model"])
        assertEquals("1.0.0", deviceRow["app_version"])
        val codeCreatedAt =
            jdbc.queryForObject(
                "SELECT created_at FROM otp_codes WHERE phone_e164 = ? ORDER BY created_at DESC LIMIT 1",
                Timestamp::class.java,
                phone,
            )
        assertEquals(codeCreatedAt, deviceRow["integrity_verified_at"])

        mvc
            .get("/v1/me") { header(HttpHeaders.AUTHORIZATION, TestAuth.bearer(body["accessToken"].asString())) }
            .andExpect { status { isOk() } }
    }

    @Test
    fun `an existing user is signed in without creating another row`() {
        val phone = TestUsers.phone()
        val existing = auth.user(phone, displayName = "Ayşe")
        val body = api.signIn(phone)
        assertFalse(body["isNewUser"].asBoolean())
        assertEquals(existing.toString(), body["user"]["id"].asString())
        assertEquals("Ayşe", body["user"]["displayName"].asString())
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM users WHERE phone_e164 = ?", Int::class.java, phone))
    }

    @Test
    fun `the sixth attempt is refused even with the right code`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        api.requestOtp(phone, device)
        val code = api.lastCode(phone)
        repeat(5) { assertInvalid(api.verifyOtp(phone, device, AuthApi.otherCode(code))) }
        assertInvalid(api.verifyOtp(phone, device, code))
        val row = jdbc.queryForMap("SELECT attempts, consumed_at FROM otp_codes WHERE phone_e164 = ?", phone)
        assertEquals(5, row["attempts"])
        assertNotNull(row["consumed_at"])
    }

    @Test
    fun `four wrong attempts still leave the fifth one usable`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        api.requestOtp(phone, device)
        val code = api.lastCode(phone)
        repeat(4) { assertInvalid(api.verifyOtp(phone, device, AuthApi.otherCode(code))) }
        assertEquals(200, api.verifyOtp(phone, device, code).status)
    }

    @Test
    fun `a consumed code is refused`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        api.requestOtp(phone, device)
        val code = api.lastCode(phone)
        assertEquals(200, api.verifyOtp(phone, device, code).status)
        assertInvalid(api.verifyOtp(phone, device, code))
    }

    @Test
    fun `an expired code is refused`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        api.requestOtp(phone, device)
        val code = api.lastCode(phone)
        jdbc.update("UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE phone_e164 = ?", phone)
        assertInvalid(api.verifyOtp(phone, device, code))
    }

    @Test
    fun `a new request closes the previous code`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        api.requestOtp(phone, device)
        val first = api.lastCode(phone)
        api.requestOtp(phone, device)
        val second = api.lastCode(phone)
        if (first != second) assertInvalid(api.verifyOtp(phone, device, first))
        assertEquals(
            1,
            jdbc.queryForObject("SELECT count(*) FROM otp_codes WHERE phone_e164 = ? AND consumed_at IS NULL", Int::class.java, phone),
        )
        assertEquals(200, api.verifyOtp(phone, device, second).status)
    }

    @Test
    fun `a code is bound to the device that requested it`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        api.requestOtp(phone, device)
        assertInvalid(api.verifyOtp(phone, UUID.randomUUID(), api.lastCode(phone)))
    }

    @Test
    fun `unknown phone, wrong code and deactivated user get the same answer`() {
        val unknown = api.verifyOtp(TestUsers.phone(), UUID.randomUUID(), "123456")
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        api.requestOtp(phone, device)
        val wrong = api.verifyOtp(phone, device, AuthApi.otherCode(api.lastCode(phone)))
        val deactivatedPhone = TestUsers.phone()
        auth.deactivate(auth.user(deactivatedPhone))
        api.requestOtp(deactivatedPhone, device)
        val deactivated = api.verifyOtp(deactivatedPhone, device, api.lastCode(deactivatedPhone))
        listOf(unknown, wrong, deactivated).forEach { assertInvalid(it) }
        val bodies =
            listOf(unknown, wrong, deactivated).map { response ->
                (json.readTree(response.contentAsString) as ObjectNode).apply { remove("traceId") }
            }
        assertEquals(1, bodies.toSet().size)
    }

    @Test
    fun `the twenty first verify from one address within ten minutes is 429`() {
        repeat(20) { assertInvalid(api.verifyOtp(TestUsers.phone(), UUID.randomUUID(), "000000")) }
        val limited = api.verifyOtp(TestUsers.phone(), UUID.randomUUID(), "000000")
        assertEquals(429, limited.status)
        assertEquals("rate_limited", json.readTree(limited.contentAsString)["code"].asString())
        assertNotNull(limited.getHeader(HttpHeaders.RETRY_AFTER))
    }

    private fun assertInvalid(response: MockHttpServletResponse) {
        assertEquals(401, response.status)
        assertEquals("auth.otp_invalid", json.readTree(response.contentAsString)["code"].asString())
    }
}
