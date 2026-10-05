package app.cetele.server.auth

import app.cetele.server.auth.sms.FakeSmsGateway
import app.cetele.server.auth.sms.SmsGateway
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import tools.jackson.databind.ObjectMapper
import java.util.UUID
import kotlin.test.assertEquals

@IntegrationTest
class LogoutTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val json: ObjectMapper,
    @Autowired sms: SmsGateway,
) {
    private val api = AuthApi(mvc, json, sms as FakeSmsGateway)

    @Test
    fun `logout revokes the refresh tokens of the caller's device only`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        val session = api.signIn(phone, device)
        val rotated = api.read(api.refresh(session["refreshToken"].asString()))
        val otherDevice = api.signIn(phone, UUID.randomUUID())

        mvc
            .post("/v1/auth/logout") { header(HttpHeaders.AUTHORIZATION, TestAuth.bearer(rotated["accessToken"].asString())) }
            .andExpect {
                status { isNoContent() }
                content { string("") }
            }

        val refused = api.refresh(rotated["refreshToken"].asString())
        assertEquals(401, refused.status)
        assertEquals("auth.refresh_invalid", api.read(refused)["code"].asString())
        assertEquals(200, api.refresh(otherDevice["refreshToken"].asString()).status)
    }

    @Test
    fun `logout needs an access token`() {
        mvc.post("/v1/auth/logout").andExpect {
            status { isUnauthorized() }
            jsonPath("$.code") { value("auth.unauthenticated") }
        }
    }
}
