package app.cetele.server.account

import app.cetele.server.auth.AuthApi
import app.cetele.server.auth.otp.OtpPurpose
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.support.IntegrationTest
import app.cetele.server.web.problem.ProblemException
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

@IntegrationTest
class ReauthTest : AccountTestSupport() {
    @Autowired private lateinit var verifier: ReauthVerifier

    @Autowired private lateinit var sms: FakeSmsGateway

    @Test
    fun `request sends to caller device and consumes the code once`() {
        val user = actor()
        val response = post("/v1/auth/reauth/request", user)
        assertEquals(202, response.status)
        assertEquals("", response.contentAsString)
        val message = assertNotNull(sms.lastMessageTo(user.actor.phone))
        val value = Regex("[0-9]{6}").find(message.text)!!.value
        verifier.require(user.caller, value, Instant.now())
        assertFailsWith<ProblemException> { verifier.require(user.caller, value, Instant.now()) }.also {
            assertEquals("auth.reauth_invalid", it.code.code)
        }
    }

    @Test
    fun `login code is refused and wrong attempts commit before correct verification`() {
        val user = actor()
        val login = code(user, OtpPurpose.LOGIN)
        problem(delete("/v1/me", user, mapOf("code" to login)), 403, "auth.reauth_invalid")
        val value = code(user)
        repeat(3) {
            problem(delete("/v1/me", user, mapOf("code" to AuthApi.otherCode(value))), 403, "auth.reauth_invalid")
        }
        assertEquals(
            3,
            jdbc.queryForObject(
                "SELECT attempts FROM otp_codes WHERE phone_e164 = ? AND purpose = 'REAUTH' AND consumed_at IS NULL",
                Int::class.java,
                user.actor.phone,
            ),
        )
        assertEquals(202, delete("/v1/me", user, mapOf("code" to value)).status)
    }

    @Test
    fun `fourth request and eleventh verification are rate limited`() {
        val user = actor()
        repeat(3) { assertEquals(202, post("/v1/auth/reauth/request", user).status) }
        val response = post("/v1/auth/reauth/request", user)
        problem(response, 429, "rate_limited")
        assertNotNull(response.getHeader("Retry-After"))
        val other = actor()
        val wrong = AuthApi.otherCode(code(other))
        repeat(10) { problem(delete("/v1/me", other, mapOf("code" to wrong)), 403, "auth.reauth_invalid") }
        problem(delete("/v1/me", other, mapOf("code" to wrong)), 429, "rate_limited")
    }
}
