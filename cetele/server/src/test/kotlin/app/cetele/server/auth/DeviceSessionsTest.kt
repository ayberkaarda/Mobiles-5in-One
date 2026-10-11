package app.cetele.server.auth

import app.cetele.server.account.AccountActor
import app.cetele.server.account.AccountTestSupport
import app.cetele.server.account.ReauthAction
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.assertNoneOf
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.test.web.servlet.get
import tools.jackson.databind.JsonNode
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@IntegrationTest
@LogCapture
class DeviceSessionsTest : AccountTestSupport() {
    @Autowired private lateinit var sms: FakeSmsGateway

    private val api: AuthApi get() = AuthApi(mvc, json, sms)

    @Test
    fun `another device ends every target family while its own refresh remains usable`(output: CapturedOutput) {
        val user = actor()
        val firstDevice = UUID.randomUUID()
        val first = api.signIn(user.actor.phone, firstDevice)
        val secondFamily = api.signIn(user.actor.phone, firstDevice)
        val current = api.signIn(user.actor.phone, user.deviceId)
        val rows = list(user)
        assertEquals(2, rows.size)
        val target = rows.single { !it["current"].asBoolean() }
        assertTrue(rows.all { it["signedIn"].asBoolean() })
        assertTrue(rows.all { it.propertyNames().toSet() == FIELDS })
        assertFalse(rows.toString().contains(firstDevice.toString()))
        assertFalse(rows.toString().contains(user.deviceId.toString()))
        val value = requestedCode(user)
        assertEquals(204, post("/v1/me/devices/${target["id"].asString()}/sign-out", user, mapOf("code" to value)).status)
        val after = list(user)
        assertFalse(after.single { !it["current"].asBoolean() }["signedIn"].asBoolean())
        assertTrue(after.single { it["current"].asBoolean() }["signedIn"].asBoolean())
        problem(api.refresh(first["refreshToken"].asString()), 401, "auth.refresh_invalid")
        problem(api.refresh(secondFamily["refreshToken"].asString()), 401, "auth.refresh_invalid")
        assertEquals(200, api.refresh(current["refreshToken"].asString()).status)
        output.assertNoneOf(
            user.actor.phone,
            value,
            first["accessToken"].asString(),
            first["refreshToken"].asString(),
            current["refreshToken"].asString(),
        )
    }

    @Test
    fun `wrong and different action codes cannot sign out a device`() {
        val user = actor()
        val session = api.signIn(user.actor.phone, user.deviceId)
        val rowId = list(user).single()["id"].asString()
        val path = "/v1/me/devices/$rowId/sign-out"
        val value = code(user, action = ReauthAction.DEVICE_SIGN_OUT)
        problem(post(path, user, mapOf("code" to AuthApi.otherCode(value))), 403, "auth.reauth_invalid")
        val accountCode = code(user)
        problem(post(path, user, mapOf("code" to accountCode)), 403, "auth.reauth_invalid")
        problem(post(path, user, emptyMap<String, String>()), 403, "auth.reauth_invalid")
        assertTrue(post(path, user).status in 400..499)
        assertTrue(list(user).single()["signedIn"].asBoolean())
        assertEquals(200, api.refresh(session["refreshToken"].asString()).status)
    }

    @Test
    fun `foreign and unknown row ids are hidden and leave code usable for own sign out`() {
        val user = actor()
        val other = actor()
        val own = api.signIn(user.actor.phone, user.deviceId)
        api.signIn(other.actor.phone, other.deviceId)
        val foreignId = list(other).single()["id"].asString()
        val value = requestedCode(user)
        listOf(foreignId, UUID.randomUUID().toString(), user.deviceId.toString()).forEach { id ->
            problem(post("/v1/me/devices/$id/sign-out", user, mapOf("code" to value)), 404, "not_found")
        }
        val ownId = list(user).single()["id"].asString()
        assertEquals(204, post("/v1/me/devices/$ownId/sign-out", user, mapOf("code" to value)).status)
        problem(api.refresh(own["refreshToken"].asString()), 401, "auth.refresh_invalid")
        assertFalse(list(user).single()["signedIn"].asBoolean())
    }

    @Test
    fun `device list excludes expired tokens and families`() {
        val user = actor()
        api.signIn(user.actor.phone, user.deviceId)
        assertTrue(list(user).single()["signedIn"].asBoolean())
        jdbc.update("UPDATE refresh_tokens SET expires_at = now() - interval '1 second' WHERE user_id = ?", user.actor.id)
        assertFalse(list(user).single()["signedIn"].asBoolean())
        jdbc.update(
            "UPDATE refresh_tokens SET expires_at = now() + interval '1 day', family_expires_at = now() - interval '1 second' " +
                "WHERE user_id = ?",
            user.actor.id,
        )
        assertFalse(list(user).single()["signedIn"].asBoolean())
    }

    private fun list(user: AccountActor): List<JsonNode> {
        val response = mvc.get("/v1/me/devices") { header(AUTHORIZATION, user.actor.bearer) }.andReturn().response
        assertEquals(200, response.status, response.contentAsString)
        return json.readTree(response.contentAsString).toList()
    }

    private fun requestedCode(user: AccountActor): String {
        assertEquals(202, post("/v1/auth/reauth/request", user, mapOf("action" to "DEVICE_SIGN_OUT")).status)
        return api.lastCode(user.actor.phone)
    }

    private companion object {
        val FIELDS = setOf("id", "model", "appVersion", "lastSeenAt", "current", "signedIn")
    }
}
