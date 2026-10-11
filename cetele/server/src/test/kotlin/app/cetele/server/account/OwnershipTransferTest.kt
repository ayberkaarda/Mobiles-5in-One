package app.cetele.server.account

import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

@IntegrationTest
class OwnershipTransferTest : AccountTestSupport() {
    @Test
    fun `target with open account deletion is refused during and after grace without consuming code`() {
        val owner = actor()
        val target = actor()
        val shopId = fixtures.shop(owner.actor)
        fixtures.addStaff(shopId, target.actor)
        assertEquals(202, delete("/v1/me", target, mapOf("code" to code(target))).status)
        val value = code(owner, action = ReauthAction.OWNERSHIP_TRANSFER, shopId = shopId)
        val body = mapOf("userId" to target.actor.id, "code" to value)
        problem(post("/v1/shops/$shopId/ownership-transfer", owner, body), 404, "not_found")
        assertEquals("OWNER", fixtures.roleOf(shopId, owner.actor.id))
        assertEquals("STAFF", fixtures.roleOf(shopId, target.actor.id))
        expire(target)
        problem(post("/v1/shops/$shopId/ownership-transfer", owner, body), 404, "not_found")
        assertEquals(204, delete("/v1/me/deletion", target).status)
        assertEquals(200, post("/v1/shops/$shopId/ownership-transfer", owner, body).status)
    }

    @Test
    fun `ineligible and self targets preserve the transfer code`() {
        val owner = actor()
        val target = actor()
        val shopId = fixtures.shop(owner.actor)
        val value = code(owner, action = ReauthAction.OWNERSHIP_TRANSFER, shopId = shopId)
        problem(
            post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to target.actor.id, "code" to value)),
            404,
            "not_found",
        )
        problem(
            post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to owner.actor.id, "code" to value)),
            409,
            "membership.owner_locked",
        )
        fixtures.addStaff(shopId, target.actor)
        assertEquals(
            200,
            post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to target.actor.id, "code" to value)).status,
        )
    }

    @Test
    fun `roles swap and exactly one owner remains`() {
        val owner = actor()
        val target = actor()
        val shopId = fixtures.shop(owner.actor)
        fixtures.addStaff(shopId, target.actor)
        val value = code(owner, action = ReauthAction.OWNERSHIP_TRANSFER, shopId = shopId)
        val response = post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to target.actor.id, "code" to value))
        assertEquals(200, response.status, response.contentAsString)
        assertEquals(target.actor.id.toString(), json.readTree(response.contentAsString)["ownerUserId"].asString())
        assertEquals(owner.actor.id.toString(), json.readTree(response.contentAsString)["previousOwnerUserId"].asString())
        assertEquals("STAFF", fixtures.roleOf(shopId, owner.actor.id))
        assertEquals("OWNER", fixtures.roleOf(shopId, target.actor.id))
        assertEquals(
            1,
            jdbc.queryForObject("SELECT count(*) FROM memberships WHERE shop_id = ? AND role = 'OWNER'", Int::class.java, shopId),
        )
    }

    @Test
    fun `foreign target self and wrong code never alter ownership`() {
        val owner = actor()
        val shopId = fixtures.shop(owner.actor)
        val target = actor()
        fixtures.addStaff(fixtures.shop(), target.actor)
        val scopedCode = code(owner, action = ReauthAction.OWNERSHIP_TRANSFER, shopId = shopId)
        problem(
            post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to target.actor.id, "code" to scopedCode)),
            404,
            "not_found",
        )
        problem(
            post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to owner.actor.id, "code" to scopedCode)),
            409,
            "membership.owner_locked",
        )
        fixtures.addStaff(shopId, target.actor)
        val value = code(owner, action = ReauthAction.OWNERSHIP_TRANSFER, shopId = shopId)
        problem(
            post(
                "/v1/shops/$shopId/ownership-transfer",
                owner,
                mapOf(
                    "userId" to target.actor.id,
                    "code" to
                        app.cetele.server.auth.AuthApi
                            .otherCode(value),
                ),
            ),
            403,
            "auth.reauth_invalid",
        )
        assertEquals("OWNER", fixtures.roleOf(shopId, owner.actor.id))
        assertEquals("STAFF", fixtures.roleOf(shopId, target.actor.id))
    }

    @Test
    fun `database rejection of promotion rolls back demotion`() {
        val owner = actor()
        val target = actor()
        val shopId = fixtures.shop(owner.actor)
        fixtures.addStaff(shopId, target.actor)
        val constraint =
            "promotion_" +
                java.util.UUID
                    .randomUUID()
                    .toString()
                    .replace("-", "")
        jdbc.execute("ALTER TABLE memberships ADD CONSTRAINT $constraint CHECK (user_id <> '${target.actor.id}' OR role <> 'OWNER')")
        try {
            val value = code(owner, action = ReauthAction.OWNERSHIP_TRANSFER, shopId = shopId)
            val response = post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to target.actor.id, "code" to value))
            assertEquals(500, response.status)
            assertEquals("OWNER", fixtures.roleOf(shopId, owner.actor.id))
            assertEquals("STAFF", fixtures.roleOf(shopId, target.actor.id))
        } finally {
            jdbc.execute("ALTER TABLE memberships DROP CONSTRAINT $constraint")
        }
    }
}
