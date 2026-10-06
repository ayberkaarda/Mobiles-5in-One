package app.cetele.server.sync

import app.cetele.server.support.IntegrationTest
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import kotlin.test.assertEquals

@IntegrationTest
class SyncIsolationTest : SyncTestSupport() {
    @Test
    fun `foreign shop endpoints hide existence from owners staff and nonmembers`() {
        val a = world()
        val b = world()
        val outsider = auth.bearer(auth.user())
        listOf(a.owner.bearer, a.staff.bearer, outsider).forEach { bearer ->
            val push =
                mvc
                    .post("/v1/shops/${b.shopId}/sync/push") {
                        header(AUTHORIZATION, bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = mapper.writeValueAsString(PushRequest(listOf(customer(1))))
                    }.andReturn()
                    .response
            val pull = mvc.get("/v1/shops/${b.shopId}/sync/pull") { header(AUTHORIZATION, bearer) }.andReturn().response
            listOf(push, pull).forEach {
                assertEquals(404, it.status)
                assertEquals("not_found", JsonPath.read(it.contentAsString, "$.code"))
            }
        }
        assertEquals(0L, ledger().head(b.shopId))
    }

    @Test
    fun `foreign entity ids conflict without changing either tenant`() {
        val a = world()
        val b = world()
        val foreignCustomer = ledger().customer(b.shopId, name = "Foreign customer")
        val foreignEntry = ledger().entry(b.shopId, foreignCustomer)
        val local = ledger().customer(a.shopId)
        val collidingEntry = entry(3, local).let { it.copy(entry = it.entry!!.copy(id = foreignEntry)) }
        assertCodes(
            push(a, listOf(customer(1, foreignCustomer, "Overwrite"), entry(2, foreignCustomer), collidingEntry)),
            "conflict",
            "conflict",
            "conflict",
        )
        assertEquals(
            "Foreign customer",
            jdbc.queryForObject("SELECT name FROM customers WHERE shop_id = ? AND id = ?", String::class.java, b.shopId, foreignCustomer),
        )
        assertEquals(12_500L, ledger().balance(b.shopId, foreignCustomer))
        assertEquals(0L, ledger().balance(a.shopId, local))
        assertEquals(0L, ledger().head(a.shopId))
        assertEquals(0L, ledger().head(b.shopId))
        assertCodes(push(a, listOf(entry(4, local))), null)
    }

    @Test
    fun `a cursor is scoped to one shop`() {
        val a = world()
        val b = world()
        assertCodes(push(b, listOf(customer(1), customer(2), customer(3))), null, null, null)
        assertCodes(push(a, listOf(customer(1))), null)
        val cursor = ledger().head(b.shopId)
        val pulled = pull(a, since = cursor)
        assertEquals(emptyList<Any>(), JsonPath.read<List<Any>>(pulled, "$.changes"))
        assertEquals(cursor, JsonPath.read<Number>(pulled, "$.nextSince").toLong())
        assertEquals(1, JsonPath.read<List<Any>>(pull(a), "$.changes").size)
    }
}
