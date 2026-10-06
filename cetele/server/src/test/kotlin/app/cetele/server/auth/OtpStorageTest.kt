package app.cetele.server.auth

import app.cetele.server.auth.otp.OtpHasher
import app.cetele.server.auth.token.RefreshTokenService
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import tools.jackson.databind.ObjectMapper
import java.util.HexFormat
import java.util.UUID
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse

@IntegrationTest
class OtpStorageTest(
    @Autowired mvc: MockMvc,
    @Autowired json: ObjectMapper,
    @Autowired sms: SmsGateway,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val hasher: OtpHasher,
) {
    private val api = AuthApi(mvc, json, sms as FakeSmsGateway)

    @Test
    fun `the database holds only the HMAC of a code, never the code`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        api.requestOtp(phone, device)
        val code = api.lastCode(phone)

        val row = jdbc.queryForMap("SELECT * FROM otp_codes WHERE phone_e164 = ?", phone)
        assertEquals(7, (row["id"] as UUID).version(), "ids are UUIDv7")
        val stored = row["code_hmac"] as ByteArray
        assertEquals(32, stored.size)
        assertContentEquals(hasher.hmac(phone, code), stored)
        assertFalse(code.toByteArray().contentEquals(stored))
        row.values.forEach { value ->
            val text = if (value is ByteArray) String(value, Charsets.ISO_8859_1) + HexFormat.of().formatHex(value) else value.toString()
            assertFalse(text.contains(code), "a column holds the code in clear text")
        }
        assertEquals(
            0,
            jdbc.queryForObject("SELECT count(*) FROM otp_codes WHERE code_hmac = convert_to(?, 'UTF8')", Int::class.java, code),
        )
    }

    @Test
    fun `the HMAC depends on the pepper, the phone and the code`() {
        val phone = TestUsers.phone()
        val other = OtpHasher(ByteArray(OtpHasher.MIN_PEPPER_BYTES) { 7 })
        assertFalse(hasher.hmac(phone, "123456").contentEquals(other.hmac(phone, "123456")))
        assertFalse(hasher.hmac(phone, "123456").contentEquals(hasher.hmac(TestUsers.phone(), "123456")))
        assertFalse(hasher.hmac(phone, "123456").contentEquals(hasher.hmac(phone, "123457")))
    }

    @Test
    fun `refresh tokens are stored as their SHA-256 only`() {
        val token = api.signIn(TestUsers.phone())["refreshToken"].asString()
        val hashes = jdbc.queryForList("SELECT token_hash FROM refresh_tokens", ByteArray::class.java)
        assertEquals(1, hashes.count { it.contentEquals(RefreshTokenService.hash(token)) })
        val ids =
            jdbc.queryForList(
                "SELECT r.id FROM refresh_tokens r WHERE r.token_hash = ? UNION ALL SELECT d.id FROM devices d JOIN refresh_tokens r " +
                    "ON r.user_id = d.user_id AND r.device_id = d.device_id WHERE r.token_hash = ?",
                UUID::class.java,
                RefreshTokenService.hash(token),
                RefreshTokenService.hash(token),
            )
        assertEquals(2, ids.size)
        ids.forEach { assertEquals(7, it!!.version(), "ids are UUIDv7") }
        assertEquals(
            0,
            jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE token_hash = convert_to(?, 'UTF8')", Int::class.java, token),
        )
    }
}
