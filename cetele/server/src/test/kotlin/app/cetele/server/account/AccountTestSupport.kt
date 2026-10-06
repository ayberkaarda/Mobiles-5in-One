package app.cetele.server.account

import app.cetele.server.auth.otp.OtpPurpose
import app.cetele.server.auth.otp.OtpService
import app.cetele.server.security.CurrentUser
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import app.cetele.server.tenancy.Actor
import app.cetele.server.tenancy.TenancyFixtures
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.ObjectMapper
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals

data class AccountActor(
    val actor: Actor,
    val deviceId: UUID,
) {
    val caller: CurrentUser get() = CurrentUser(actor.id, deviceId)
}

abstract class AccountTestSupport {
    @Autowired protected lateinit var mvc: MockMvc

    @Autowired protected lateinit var auth: TestAuth

    @Autowired protected lateinit var jdbc: JdbcTemplate

    @Autowired protected lateinit var json: ObjectMapper

    @Autowired protected lateinit var otp: OtpService

    @Autowired protected lateinit var tx: TransactionTemplate

    protected val fixtures: TenancyFixtures get() = TenancyFixtures(mvc, auth, jdbc)

    protected fun actor(): AccountActor {
        val phone = TestUsers.phone()
        val userId = auth.user(phone)
        val deviceId = UUID.randomUUID()
        return AccountActor(Actor(userId, phone, auth.bearer(userId, deviceId)), deviceId)
    }

    protected fun code(
        user: AccountActor,
        purpose: OtpPurpose = OtpPurpose.REAUTH,
    ): String {
        val text = tx.execute { otp.issue(user.actor.phone, user.deviceId, purpose, Instant.now()) }
        return Regex("[0-9]{6}").find(text)!!.value
    }

    protected fun post(
        path: String,
        user: AccountActor,
        body: Any? = null,
    ): MockHttpServletResponse =
        mvc
            .post(path) {
                header(AUTHORIZATION, user.actor.bearer)
                if (body != null) {
                    contentType = MediaType.APPLICATION_JSON
                    content = json.writeValueAsString(body)
                }
            }.andReturn()
            .response

    protected fun delete(
        path: String,
        user: AccountActor,
        body: Any? = null,
    ): MockHttpServletResponse =
        mvc
            .delete(path) {
                header(AUTHORIZATION, user.actor.bearer)
                if (body != null) {
                    contentType = MediaType.APPLICATION_JSON
                    content = json.writeValueAsString(body)
                }
            }.andReturn()
            .response

    protected fun me(user: AccountActor): MockHttpServletResponse =
        mvc.get("/v1/me") { header(AUTHORIZATION, user.actor.bearer) }.andReturn().response

    protected fun problem(
        response: MockHttpServletResponse,
        status: Int,
        code: String,
    ) {
        assertEquals(status, response.status, response.contentAsString)
        assertEquals(code, json.readTree(response.contentAsString)["code"].asString())
    }

    protected fun expire(user: AccountActor) {
        jdbc.update(
            "UPDATE deletion_requests SET requested_at = now() - interval '15 days', grace_until = now() - interval '1 day' WHERE user_id = ? AND completed_at IS NULL AND cancelled_at IS NULL",
            user.actor.id,
        )
    }

    protected fun count(
        table: String,
        column: String,
        id: UUID,
    ): Int = jdbc.queryForObject("SELECT count(*) FROM $table WHERE $column = ?", Int::class.java, id)!!
}
