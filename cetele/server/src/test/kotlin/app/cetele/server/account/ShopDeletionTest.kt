package app.cetele.server.account

import app.cetele.server.account.deletion.DeletionExecutor
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.time.Instant
import kotlin.test.assertEquals

@IntegrationTest
class ShopDeletionTest : AccountTestSupport() {
    @Autowired private lateinit var executor: DeletionExecutor

    @Test
    fun `staff cannot delete and retains their account after shop deletion`() {
        val owner = actor()
        val staff = actor()
        val shopId = fixtures.shop(owner.actor)
        fixtures.addStaff(shopId, staff.actor)
        problem(delete("/v1/shops/$shopId", staff, mapOf("code" to code(staff))), 403, "forbidden")
        assertEquals(202, delete("/v1/shops/$shopId", owner, mapOf("code" to code(owner))).status)
        problem(delete("/v1/shops/$shopId", owner, mapOf("code" to code(owner))), 409, "shop.deletion_pending")
        expire(owner)
        executor.run(Instant.now())
        assertEquals(0, count("shops", "id", shopId))
        assertEquals(0, count("memberships", "shop_id", shopId))
        assertEquals(200, me(staff).status)
        assertEquals(200, me(owner).status)
    }
}
