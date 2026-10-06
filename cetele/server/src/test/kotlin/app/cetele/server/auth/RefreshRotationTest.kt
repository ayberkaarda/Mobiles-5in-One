package app.cetele.server.auth

import app.cetele.server.auth.token.RefreshTokenService
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
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
import tools.jackson.databind.ObjectMapper
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@IntegrationTest
class RefreshRotationTest(
    @Autowired mvc: MockMvc,
    @Autowired private val json: ObjectMapper,
    @Autowired sms: SmsGateway,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val codec: JwtCodec,
    @Autowired private val auth: TestAuth,
) {
    private val api = AuthApi(mvc, json, sms as FakeSmsGateway)

    @Test
    fun `a refresh rotates the token and keeps the family`() {
        val device = UUID.randomUUID()
        val signIn = api.signIn(TestUsers.phone(), device)
        val first = signIn["refreshToken"].asString()
        val response = api.refresh(first)
        assertEquals(200, response.status)
        val body = api.read(response)
        assertEquals(setOf("accessToken", "expiresIn", "refreshToken"), body.propertyNames().toSet())
        val second = body["refreshToken"].asString()
        assertNotEquals(first, second)
        assertEquals(device, codec.verify(body["accessToken"].asString()).deviceId)

        val old = row(first)
        val new = row(second)
        assertNotNull(old["revoked_at"])
        assertEquals(null, new["revoked_at"])
        assertEquals(old["id"], new["rotated_from"])
        assertEquals(old["family_id"], new["family_id"])

        assertEquals(200, api.refresh(second).status)
    }

    @Test
    fun `reusing a rotated token revokes the family, old and new tokens are dead`() {
        val signIn = api.signIn(TestUsers.phone())
        val first = signIn["refreshToken"].asString()
        val second = api.read(api.refresh(first))["refreshToken"].asString()

        assertInvalid(api.refresh(first))
        assertInvalid(api.refresh(second))

        val family = row(first)["family_id"]
        val live =
            jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE family_id = ? AND revoked_at IS NULL", Int::class.java, family)
        assertEquals(0, live)
    }

    @Test
    fun `reuse revokes only its own family`() {
        val phone = TestUsers.phone()
        val stolen = api.signIn(phone, UUID.randomUUID())["refreshToken"].asString()
        val otherDevice = api.signIn(phone, UUID.randomUUID())["refreshToken"].asString()
        api.refresh(stolen)
        assertInvalid(api.refresh(stolen))
        assertEquals(200, api.refresh(otherDevice).status)
    }

    @Test
    fun `unknown, malformed and expired tokens are 401 refresh_invalid`() {
        val random = ByteArray(32).also { SecureRandom().nextBytes(it) }
        assertInvalid(api.refresh(Base64.getUrlEncoder().withoutPadding().encodeToString(random)))
        assertInvalid(api.refresh("x".repeat(100)))

        val token = api.signIn(TestUsers.phone())["refreshToken"].asString()
        jdbc.update(
            "UPDATE refresh_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = ?",
            RefreshTokenService.hash(token),
        )
        assertInvalid(api.refresh(token))
    }

    @Test
    fun `a deactivated user cannot refresh`() {
        val token = api.signIn(TestUsers.phone())["refreshToken"].asString()
        val user = row(token)["user_id"] as UUID
        auth.deactivate(user)
        assertInvalid(api.refresh(token))
    }

    @Test
    fun `the thirty first refresh of a device within a minute is 429`() {
        var token = api.signIn(TestUsers.phone())["refreshToken"].asString()
        repeat(30) {
            val response = api.refresh(token, ip = AuthApi.randomIp())
            assertEquals(200, response.status)
            token = api.read(response)["refreshToken"].asString()
        }
        val limited = api.refresh(token, ip = AuthApi.randomIp())
        assertEquals(429, limited.status)
        assertNotNull(limited.getHeader(HttpHeaders.RETRY_AFTER))
        assertTrue(row(token)["revoked_at"] == null, "a rate limited call leaves the token usable later")
    }

    @Test
    fun `unknown tokens are limited per address`() {
        repeat(30) { assertInvalid(api.refresh("unknown-" + UUID.randomUUID())) }
        assertEquals(429, api.refresh("unknown-" + UUID.randomUUID()).status)
    }

    @Test
    fun `an address over its unknown-token budget is refused before the token is looked at`() {
        val token = api.signIn(TestUsers.phone())["refreshToken"].asString()
        repeat(30) { assertInvalid(api.refresh("unknown-" + UUID.randomUUID())) }
        val refused = api.refresh(token)
        assertEquals(429, refused.status)
        assertTrue(row(token)["revoked_at"] == null, "the valid token was not touched")
        assertEquals(200, api.refresh(token, ip = AuthApi.randomIp()).status)
    }

    @Test
    fun `a replay after the device budget is used up still revokes the family`() {
        val stolen = api.signIn(TestUsers.phone())["refreshToken"].asString()
        var token = stolen
        repeat(30) {
            val response = api.refresh(token, ip = AuthApi.randomIp())
            assertEquals(200, response.status)
            token = api.read(response)["refreshToken"].asString()
        }
        assertInvalid(api.refresh(stolen, ip = AuthApi.randomIp()))
        val family = row(stolen)["family_id"]
        val live =
            jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE family_id = ? AND revoked_at IS NULL", Int::class.java, family)
        assertEquals(0, live, "throttling must not shield a stolen family from reuse detection")
    }

    private fun row(token: String): Map<String, Any?> =
        jdbc.queryForMap(
            "SELECT id, user_id, family_id, rotated_from, revoked_at FROM refresh_tokens WHERE token_hash = ?",
            RefreshTokenService.hash(token),
        )

    private fun assertInvalid(response: MockHttpServletResponse) {
        assertEquals(401, response.status)
        assertEquals("auth.refresh_invalid", json.readTree(response.contentAsString)["code"].asString())
    }
}
