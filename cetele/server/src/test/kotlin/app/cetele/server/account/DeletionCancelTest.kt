package app.cetele.server.account

import app.cetele.server.account.deletion.DeletionExecutor
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@IntegrationTest
class DeletionCancelTest : AccountTestSupport() {
    @Autowired private lateinit var executor: DeletionExecutor

    @Test
    fun `cancelling account cancels linked shops and keeps account usable`() {
        val user = actor()
        val shopId = fixtures.shop(user.actor)
        val response = delete("/v1/me", user, mapOf("code" to code(user)))
        assertEquals(202, response.status)
        val body = json.readTree(response.contentAsString)
        assertEquals(
            14L,
            java.time.Duration
                .between(Instant.parse(body["requestedAt"].asString()), Instant.parse(body["graceUntil"].asString()))
                .toDays(),
        )
        assertTrue(json.readTree(me(user).contentAsString)["deletion"].isObject)
        problem(delete("/v1/me", user, mapOf("code" to code(user))), 409, "account.deletion_pending")
        assertEquals(204, delete("/v1/me/deletion", user).status)
        assertEquals(
            2,
            jdbc.queryForObject(
                "SELECT count(*) FROM deletion_requests WHERE user_id = ? AND cancelled_at IS NOT NULL",
                Int::class.java,
                user.actor.id,
            ),
        )
        assertTrue(json.readTree(me(user).contentAsString)["deletion"].isNull)
        problem(delete("/v1/me/deletion", user), 404, "not_found")
        executor.run(Instant.now())
        assertEquals(1, count("shops", "id", shopId))
        assertEquals(200, me(user).status)
    }

    @Test
    fun `account request keeps an earlier shop request and its cancel leaves that request open`() {
        val user = actor()
        val shopId = fixtures.shop(user.actor)
        assertEquals(202, delete("/v1/shops/$shopId", user, mapOf("code" to code(user))).status)
        val response = delete("/v1/me", user, mapOf("code" to code(user)))
        assertEquals(202, response.status, response.contentAsString)
        assertEquals(shopId.toString(), json.readTree(response.contentAsString)["shopsToDelete"][0].asString())
        assertEquals(1, count("deletion_requests", "shop_id", shopId))
        assertEquals(204, delete("/v1/me/deletion", user).status)
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM deletion_requests WHERE shop_id = ? AND cancelled_at IS NULL AND completed_at IS NULL",
                Int::class.java,
                shopId,
            ),
        )
    }

    @Test
    fun `shop cancellation does not cancel an independent account request`() {
        val user = actor()
        val shopId = fixtures.shop(user.actor)
        assertEquals(202, delete("/v1/shops/$shopId", user, mapOf("code" to code(user))).status)
        assertEquals(204, delete("/v1/shops/$shopId/deletion", user).status)
        problem(delete("/v1/shops/$shopId/deletion", user), 404, "not_found")
        assertEquals(1, count("shops", "id", shopId))
    }
}
