package app.cetele.server.statements

import app.cetele.server.statements.link.StatementLinkHasher
import app.cetele.server.support.IntegrationTest
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@IntegrationTest
class StatementLinkEndpointTest : StatementTestSupport() {
    @Autowired lateinit var hasher: StatementLinkHasher

    @Test
    fun `link returns a capability and stores only its hash`() {
        val w = world()
        val c = ledger().customer(w.shopId)
        val response = issue(w, c)
        assertEquals(201, response.status)
        val token = JsonPath.read<String>(response.contentAsString, "$.token")
        val url = JsonPath.read<String>(response.contentAsString, "$.url")
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(token))
        assertTrue(url.endsWith("/s/$token"))
        assertEquals(1, Regex("\"token\"").findAll(response.contentAsString).count())
        val stored = jdbc.queryForObject("SELECT token_hash FROM statement_links WHERE customer_id = ?", String::class.java, c)!!
        assertEquals(hasher.hash(token), stored)
        assertFalse(stored.contains(token))
        assertEquals(200, open(token).status)
    }

    @Test
    fun `twenty first active link is rejected and foreign customers stay hidden`() {
        val w = world()
        val c = ledger().customer(w.shopId)
        repeat(20) { assertEquals(201, issue(w, c).status) }
        val limited = issue(w, c)
        assertEquals(409, limited.status)
        assertEquals("statement.link_limit", JsonPath.read(limited.contentAsString, "$.code"))
        val foreign = world()
        val response = issue(w, ledger().customer(foreign.shopId))
        assertEquals(404, response.status)
        ledger().deleteCustomer(w.shopId, c)
        assertEquals(404, issue(w, c).status)
    }
}
