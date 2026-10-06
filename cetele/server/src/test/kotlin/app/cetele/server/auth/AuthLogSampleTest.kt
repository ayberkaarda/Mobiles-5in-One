package app.cetele.server.auth

import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.http.HttpHeaders
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import tools.jackson.databind.ObjectMapper
import java.util.UUID
import kotlin.test.assertEquals

/** Spec section 6 item 14: a log sample of the whole sign-in flow holds no phone, code or token. */
@IntegrationTest
@LogCapture
class AuthLogSampleTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val json: ObjectMapper,
    @Autowired sms: SmsGateway,
) {
    private val api = AuthApi(mvc, json, sms as FakeSmsGateway)

    @Test
    fun `the full OTP flow logs no phone, code or token`(output: CapturedOutput) {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()

        assertEquals(403, api.requestOtp(phone, device, integrityToken = "fake.unrecognized-app").status)
        assertEquals(202, api.requestOtp(phone, device).status)
        val code = api.lastCode(phone)
        assertEquals(401, api.verifyOtp(phone, device, AuthApi.otherCode(code)).status)
        val session = api.read(api.verifyOtp(phone, device, code))
        val access = session["accessToken"].asString()
        val refresh = session["refreshToken"].asString()
        val rotated = api.read(api.refresh(refresh))
        assertEquals(401, api.refresh(refresh).status)
        mvc.get("/v1/me") { header(HttpHeaders.AUTHORIZATION, TestAuth.bearer(access)) }
        mvc.post("/v1/auth/logout") { header(HttpHeaders.AUTHORIZATION, TestAuth.bearer(access)) }

        output.assertContains(TestUsers.masked(phone))
        output.assertContains("outcome=signed_in")
        output.assertContains("outcome=reuse_detected")
        output.assertNoneOf(
            phone,
            phone.removePrefix("+"),
            phone.takeLast(10),
            code,
            access,
            refresh,
            rotated["accessToken"].asString(),
            rotated["refreshToken"].asString(),
            AuthApi.otherCode(code),
        )
    }
}
