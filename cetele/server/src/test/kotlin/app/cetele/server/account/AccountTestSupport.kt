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
        action: ReauthAction = ReauthAction.ACCOUNT_DELETE,
        shopId: UUID? = null,
    ): String {
        val scope = if (purpose == OtpPurpose.REAUTH) action.scope(shopId) else null
        val text = tx.execute { otp.issue(user.actor.phone, user.deviceId, purpose, Instant.now(), scope) }
        return Regex("[0-9]{6}").find(text)!!.value
    }

    /** A reauthentication code bound to deleting [shopId]. */
    protected fun shopCode(
        user: AccountActor,
        shopId: UUID,
    ): String = code(user, action = ReauthAction.SHOP_DELETE, shopId = shopId)

    /** A reauthentication code bound to transferring [shopId]. */
    protected fun transferCode(
        user: AccountActor,
        shopId: UUID,
    ): String = code(user, action = ReauthAction.OWNERSHIP_TRANSFER, shopId = shopId)

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
            "UPDATE deletion_requests SET requested_at = now() - interval '15 days', grace_until = now() - interval '1 day' " +
                "WHERE user_id = ? AND completed_at IS NULL AND cancelled_at IS NULL",
            user.actor.id,
        )
    }

    protected fun count(
        table: String,
        column: String,
        id: UUID,
    ): Int = jdbc.queryForObject("SELECT count(*) FROM $table WHERE $column = ?", Int::class.java, id)!!

    /** An `ACTIVE` Play subscription of [shopId] linked by [linkedBy], with an encrypted token stand-in. */
    protected fun linkedSubscription(
        shopId: UUID,
        linkedBy: UUID,
    ): UUID {
        val id = UUID.randomUUID()
        val hash =
            java.util.HexFormat.of().formatHex(
                java.security.MessageDigest
                    .getInstance("SHA-256")
                    .digest(id.toString().toByteArray()),
            )
        jdbc.update(
            "INSERT INTO subscriptions (id, shop_id, purchase_token_hash, purchase_token_enc, product_id, base_plan_id, state, " +
                "expires_at, linked_by, linked_at, last_verified_at) " +
                "VALUES (?, ?, ?, ?, 'cetele_pro', 'monthly', 'ACTIVE', now() + interval '30 days', ?, now(), now())",
            id,
            shopId,
            hash,
            ByteArray(48).also { java.security.SecureRandom().nextBytes(it) },
            linkedBy,
        )
        return id
    }

    protected fun subscription(id: UUID): Map<String, Any?> =
        jdbc.queryForMap(
            "SELECT shop_id, linked_by, state, purchase_token_enc, purchase_token_hash FROM subscriptions WHERE id = ?",
            id,
        )

    /** `SYSTEM` completion rows of [action] written since [since] with `metadata.shops` = [shops]. */
    protected fun completionRows(
        action: String,
        since: Instant,
        shops: Int,
    ): Int =
        jdbc.queryForObject(
            "SELECT count(*) FROM audit_logs WHERE action = ? AND actor_type = 'SYSTEM' AND actor_id IS NULL " +
                "AND target_id IS NULL AND at >= ? AND metadata = jsonb_build_object('shops', ?::int)",
            Int::class.java,
            action,
            java.sql.Timestamp.from(since),
            shops,
        )!!
}
