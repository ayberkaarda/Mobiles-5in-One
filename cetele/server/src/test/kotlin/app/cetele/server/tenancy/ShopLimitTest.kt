package app.cetele.server.tenancy

import app.cetele.server.account.AccountActor
import app.cetele.server.account.AccountStore
import app.cetele.server.account.AccountTestSupport
import app.cetele.server.account.deletion.DeletionExecutor
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@IntegrationTest
class ShopLimitTest : AccountTestSupport() {
    @Autowired private lateinit var store: AccountStore

    @Autowired private lateinit var executor: DeletionExecutor

    private val input = mapOf("name" to "Yeni Bakkal", "type" to "BAKKAL", "il" to "İstanbul", "ilce" to "Kadıköy")

    private fun create(owner: AccountActor) = post("/v1/shops", owner, input)

    @Test
    fun `fourth owned shop is refused without creating rows and staff does not count`() {
        val owner = actor()
        fixtures.addStaff(fixtures.shop(), owner.actor)
        repeat(3) { assertEquals(201, create(owner).status) }
        problem(create(owner), 409, "shop.limit_reached")
        assertEquals(3, count("shops", "created_by", owner.actor.id))
        assertEquals(4, count("memberships", "user_id", owner.actor.id))
    }

    @Test
    fun `completed shop deletion frees a slot but grace does not`() {
        val owner = actor()
        val shopId = fixtures.shop(owner.actor)
        repeat(2) { fixtures.shop(owner.actor) }
        assertEquals(202, delete("/v1/shops/$shopId", owner, mapOf("code" to shopCode(owner, shopId))).status)
        problem(create(owner), 409, "shop.limit_reached")
        expire(owner)
        executor.run(Instant.now())
        assertEquals(0, count("shops", "id", shopId))
        assertEquals(201, create(owner).status)
        assertEquals(3, count("shops", "created_by", owner.actor.id))
    }

    @Test
    fun `only active ownership counts regardless of who created the shop`() {
        val owner = actor()
        val shops = List(3) { fixtures.shop(owner.actor) }
        val nextOwner = fixtures.addStaff(shops.first())
        tx.execute {
            jdbc.update("UPDATE memberships SET role = 'STAFF' WHERE shop_id = ? AND user_id = ?", shops.first(), owner.actor.id)
            jdbc.update("UPDATE memberships SET role = 'OWNER' WHERE shop_id = ? AND user_id = ?", shops.first(), nextOwner.id)
        }
        assertEquals(201, create(owner).status)
        jdbc.update("UPDATE shops SET deleted_at = now() WHERE id = ?", shops.last())
        assertEquals(201, create(owner).status)
        problem(create(owner), 409, "shop.limit_reached")
    }

    @Test
    fun `parallel creates wait for the user lock and cannot exceed three`() {
        val owner = actor()
        repeat(2) { fixtures.shop(owner.actor) }
        val pool = Executors.newFixedThreadPool(2)
        try {
            val futures =
                tx.execute {
                    store.lockUser(owner.actor.id)
                    val requests = List(2) { pool.submit<org.springframework.mock.web.MockHttpServletResponse> { create(owner) } }
                    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
                    var waiting = 0
                    while (waiting < 2 && System.nanoTime() < deadline && requests.none { it.isDone }) {
                        waiting =
                            jdbc.queryForObject(
                                "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' " +
                                    "AND datname = current_database() AND pid <> pg_backend_pid()",
                                Int::class.java,
                            )!!
                    }
                    assertEquals(2, waiting, "both creates must wait for the existing user row lock")
                    requests
                }!!
            val responses = futures.map { it.get(30, TimeUnit.SECONDS) }
            assertEquals(listOf(201, 409), responses.map { it.status }.sorted())
            problem(responses.single { it.status == 409 }, 409, "shop.limit_reached")
            assertEquals(3, count("shops", "created_by", owner.actor.id))
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `shop ceiling defaults to three and invalid ceilings are rejected`() {
        assertEquals(3, TenancyProperties().maxOwnedShops)
        assertTrue(TenancyProperties(5).maxOwnedShops == 5)
        listOf(0, -1).forEach { assertFailsWith<IllegalArgumentException> { TenancyProperties(it) } }
    }
}
