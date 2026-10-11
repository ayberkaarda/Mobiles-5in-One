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
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class ReauthTest : AccountTestSupport() {
    @Autowired private lateinit var verifier: ReauthVerifier

    @Autowired private lateinit var sms: FakeSmsGateway

    @Test
    fun `request sends to caller device and consumes the code once`() {
        val user = actor()
        val response = request(user)
        assertEquals(202, response.status)
        assertEquals("", response.contentAsString)
        val message = assertNotNull(sms.lastMessageTo(user.actor.phone))
        val value = Regex("[0-9]{6}").find(message.text)!!.value
        verifier.require(user.caller, value, Instant.now(), ReauthAction.ACCOUNT_DELETE.scope())
        assertFailsWith<ProblemException> {
            verifier.require(user.caller, value, Instant.now(), ReauthAction.ACCOUNT_DELETE.scope())
        }.also {
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
        repeat(3) { assertEquals(202, request(user).status) }
        val response = request(user)
        problem(response, 429, "rate_limited")
        assertNotNull(response.getHeader("Retry-After"))
        val other = actor()
        val wrong = AuthApi.otherCode(code(other))
        repeat(10) { problem(delete("/v1/me", other, mapOf("code" to wrong)), 403, "auth.reauth_invalid") }
        problem(delete("/v1/me", other, mapOf("code" to wrong)), 429, "rate_limited")
    }

    @Test
    fun `missing body invalid action and unowned shop send no SMS`() {
        val user = actor()
        assertTrue(post("/v1/auth/reauth/request", user).status in 400..499)
        assertTrue(post("/v1/auth/reauth/request", user, mapOf("action" to "UNKNOWN")).status in 400..499)
        problem(request(user, ReauthAction.SHOP_DELETE), 404, "not_found")
        val otherShop = fixtures.shop()
        problem(request(user, ReauthAction.SHOP_DELETE, otherShop), 404, "not_found")
        fixtures.addStaff(otherShop, user.actor)
        problem(request(user, ReauthAction.OWNERSHIP_TRANSFER, otherShop), 404, "not_found")
        val deletedShop = fixtures.shop(user.actor)
        jdbc.update("UPDATE shops SET deleted_at = now() WHERE id = ?", deletedShop)
        problem(request(user, ReauthAction.SHOP_DELETE, deletedShop), 404, "not_found")
        assertNull(sms.lastMessageTo(user.actor.phone))
    }

    @Test
    fun `shop and action mismatches count as wrong attempts and leave the correct scope usable`() {
        val user = actor()
        val target = actor()
        val firstShop = fixtures.shop(user.actor)
        val secondShop = fixtures.shop(user.actor)
        fixtures.addStaff(secondShop, target.actor)
        assertEquals(202, request(user, ReauthAction.SHOP_DELETE, firstShop).status)
        val value = Regex("[0-9]{6}").find(assertNotNull(sms.lastMessageTo(user.actor.phone)).text)!!.value
        problem(delete("/v1/shops/$secondShop", user, mapOf("code" to value)), 403, "auth.reauth_invalid")
        problem(
            post("/v1/shops/$secondShop/ownership-transfer", user, mapOf("userId" to target.actor.id, "code" to value)),
            403,
            "auth.reauth_invalid",
        )
        problem(delete("/v1/me", user, mapOf("code" to value, "deleteOwnedShops" to true)), 403, "auth.reauth_invalid")
        assertEquals(
            3,
            jdbc.queryForObject(
                "SELECT attempts FROM otp_codes WHERE phone_e164 = ? AND purpose = 'REAUTH' AND consumed_at IS NULL",
                Int::class.java,
                user.actor.phone,
            ),
        )
        assertEquals(202, delete("/v1/shops/$firstShop", user, mapOf("code" to value)).status)
    }

    @Test
    fun `three reauth requests leave the login phone bucket available`() {
        val user = actor()
        repeat(3) { assertEquals(202, request(user).status) }
        val api = AuthApi(mvc, json, sms)
        assertEquals(202, api.requestOtp(user.actor.phone, user.deviceId).status)
    }

    @Test
    fun `pending account refusal preserves code for use after cancellation`() {
        val user = actor()
        assertEquals(202, delete("/v1/me", user, mapOf("code" to code(user))).status)
        val value = code(user)
        problem(delete("/v1/me", user, mapOf("code" to value)), 409, "account.deletion_pending")
        assertEquals(204, delete("/v1/me/deletion", user).status)
        assertEquals(202, delete("/v1/me", user, mapOf("code" to value)).status)
    }

    @Test
    fun `shared shop refusal preserves code for explicit deletion choice`() {
        val user = actor()
        val shopId = fixtures.shop(user.actor)
        fixtures.addStaff(shopId, actor().actor)
        val value = code(user)
        problem(delete("/v1/me", user, mapOf("code" to value)), 409, "account.owner_of_shared_shop")
        assertEquals(202, delete("/v1/me", user, mapOf("code" to value, "deleteOwnedShops" to true)).status)
    }

    @Test
    fun `pending shop refusal preserves code after cancellation`() {
        val user = actor()
        val shopId = fixtures.shop(user.actor)
        val first = code(user, action = ReauthAction.SHOP_DELETE, shopId = shopId)
        assertEquals(202, delete("/v1/shops/$shopId", user, mapOf("code" to first)).status)
        val value = code(user, action = ReauthAction.SHOP_DELETE, shopId = shopId)
        problem(delete("/v1/shops/$shopId", user, mapOf("code" to value)), 409, "shop.deletion_pending")
        assertEquals(204, delete("/v1/shops/$shopId/deletion", user).status)
        assertEquals(202, delete("/v1/shops/$shopId", user, mapOf("code" to value)).status)
    }

    private fun request(
        user: AccountActor,
        action: ReauthAction = ReauthAction.ACCOUNT_DELETE,
        shopId: java.util.UUID? = null,
    ) = post("/v1/auth/reauth/request", user, mapOf("action" to action.name, "shopId" to shopId))
}
