package app.cetele.server.account

import app.cetele.server.account.deletion.DeletionExecutor
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@IntegrationTest
class DeletionBlockedTest : AccountTestSupport() {
    @Autowired private lateinit var executor: DeletionExecutor

    @Test
    fun `shared shop requires explicit deletion choice`() {
        val owner = actor()
        val shopId = fixtures.shop(owner.actor)
        fixtures.addStaff(shopId)
        problem(delete("/v1/me", owner, mapOf("code" to code(owner))), 409, "account.owner_of_shared_shop")
        assertEquals(0, count("deletion_requests", "user_id", owner.actor.id))
        val response = delete("/v1/me", owner, mapOf("code" to code(owner), "deleteOwnedShops" to true))
        assertEquals(202, response.status)
        assertEquals(shopId.toString(), json.readTree(response.contentAsString)["shopsToDelete"][0].asString())
    }

    @Test
    fun `new shared ownership during grace blocks account and transfer clears block`() {
        val owner = actor()
        assertEquals(202, delete("/v1/me", owner, mapOf("code" to code(owner))).status)
        val shopId = fixtures.shop(owner.actor)
        val staff = actor()
        fixtures.addStaff(shopId, staff.actor)
        expire(owner)
        executor.run(Instant.now())
        assertTrue(json.readTree(me(owner).contentAsString)["deletion"]["blocked"].asBoolean())
        assertEquals(1, count("users", "id", owner.actor.id))
        val response = post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to staff.actor.id, "code" to code(owner)))
        assertEquals(200, response.status)
        assertFalse(json.readTree(me(owner).contentAsString)["deletion"]["blocked"].asBoolean())
        executor.run(Instant.now())
        assertEquals(0, count("users", "id", owner.actor.id))
        assertEquals(1, count("shops", "id", shopId))
        assertEquals("OWNER", fixtures.roleOf(shopId, staff.actor.id))
    }

    @Test
    fun `scheduled shop that gains a member during grace is kept and blocks the account until transfer`() {
        val owner = actor()
        val shopId = fixtures.shop(owner.actor)
        val response = delete("/v1/me", owner, mapOf("code" to code(owner)))
        assertEquals(202, response.status)
        assertEquals(shopId.toString(), json.readTree(response.contentAsString)["shopsToDelete"][0].asString())
        val staff = actor()
        fixtures.addStaff(shopId, staff.actor)
        expire(owner)
        executor.run(Instant.now())
        assertEquals(1, count("shops", "id", shopId))
        assertEquals("STAFF", fixtures.roleOf(shopId, staff.actor.id))
        assertEquals(1, count("users", "id", owner.actor.id))
        assertTrue(json.readTree(me(owner).contentAsString)["deletion"]["blocked"].asBoolean())
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM deletion_requests WHERE shop_id = ? AND blocked_at IS NOT NULL AND completed_at IS NULL",
                Int::class.java,
                shopId,
            ),
        )
        val transfer = post("/v1/shops/$shopId/ownership-transfer", owner, mapOf("userId" to staff.actor.id, "code" to code(owner)))
        assertEquals(200, transfer.status, transfer.contentAsString)
        executor.run(Instant.now())
        assertEquals(0, count("users", "id", owner.actor.id))
        assertEquals(1, count("shops", "id", shopId))
        assertEquals("OWNER", fixtures.roleOf(shopId, staff.actor.id))
        assertEquals(
            1,
            jdbc.queryForObject(
                "SELECT count(*) FROM deletion_requests WHERE shop_id = ? AND cancelled_at IS NOT NULL AND completed_at IS NULL",
                Int::class.java,
                shopId,
            ),
        )
    }

    @Test
    fun `shop becoming empty of other members clears block on next run`() {
        val owner = actor()
        assertEquals(202, delete("/v1/me", owner, mapOf("code" to code(owner))).status)
        val shopId = fixtures.shop(owner.actor)
        val staff = fixtures.addStaff(shopId)
        expire(owner)
        executor.run(Instant.now())
        assertTrue(json.readTree(me(owner).contentAsString)["deletion"]["blocked"].asBoolean())
        jdbc.update("DELETE FROM memberships WHERE shop_id = ? AND user_id = ?", shopId, staff.id)
        executor.run(Instant.now())
        assertEquals(0, count("shops", "id", shopId))
        assertEquals(0, count("users", "id", owner.actor.id))
    }
}
