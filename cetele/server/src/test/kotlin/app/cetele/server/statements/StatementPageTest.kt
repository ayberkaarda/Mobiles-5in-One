package app.cetele.server.statements

import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import java.time.Duration
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@IntegrationTest
class StatementPageTest : StatementTestSupport() {
    @Test
    fun `reversed entries stay visible without changing the running balance`() {
        val w = world()
        val c = ledger().customer(w.shopId)
        val original = ledger().entry(w.shopId, c, amountMinor = 1200, note = "Corrected debt")
        val reversal = ledger().entry(w.shopId, c, amountMinor = 1200, reverses = original)
        jdbc.update("UPDATE ledger_entries SET reversed_by = ? WHERE id = ? AND shop_id = ?", reversal, original, w.shopId)
        ledger().entry(w.shopId, c, amountMinor = 500)
        val link = links.issue(w.shopId, c, w.owner.id, now = clock.instant())
        val html = open(link.token).contentAsString
        assertTrue(html.contains("class=\"reversed\""))
        assertTrue(html.contains("Corrected debt"))
        assertTrue(html.contains("Düzeltme"))
        assertTrue(html.contains("₺5,00"))
        assertEquals(500L, ledger().balance(w.shopId, c))
    }

    @Test
    fun `page shows rows and balance and records every opening`() {
        val w = world()
        val c = ledger().customer(w.shopId, name = "Page Customer")
        ledger().entry(w.shopId, c, amountMinor = 12500, note = "Bread")
        ledger().entry(w.shopId, c, type = "PAYMENT", amountMinor = 2500)
        val link = links.issue(w.shopId, c, w.owner.id, now = clock.instant())
        repeat(2) {
            val response = open(link.token)
            assertEquals(200, response.status)
            assertTrue(response.contentAsString.contains("Page Customer"))
            assertTrue(response.contentAsString.contains("Bread"))
            assertTrue(response.contentAsString.contains("₺100,00"))
            assertEquals("no-store", response.getHeader("Cache-Control"))
            assertEquals("no-cache", response.getHeader("Pragma"))
            assertEquals("noindex, nofollow", response.getHeader("X-Robots-Tag"))
            assertTrue(response.contentType!!.contains("text/html"))
            val nonce = Regex("nonce=\"([^\"]+)\"").find(response.contentAsString)!!.groupValues[1]
            assertTrue(response.getHeader("Content-Security-Policy")!!.contains("nonce-$nonce"))
            assertTrue(response.contentAsString.contains("name=\"robots\" content=\"noindex, nofollow\""))
        }
        assertEquals(2, jdbc.queryForObject("SELECT open_count FROM statement_links WHERE id = ?", Int::class.java, link.id))
        assertNotNull(jdbc.queryForObject("SELECT opened_at FROM statement_links WHERE id = ?", java.sql.Timestamp::class.java, link.id))
    }

    @Test
    fun `all unusable links share one error page`() {
        val w = world()
        val c = ledger().customer(w.shopId)
        val expired = links.issue(w.shopId, c, w.owner.id, ttl = Duration.ofSeconds(1), now = clock.instant().minusSeconds(10))
        val revoked = links.issue(w.shopId, c, w.owner.id, now = clock.instant())
        jdbc.update("UPDATE statement_links SET revoked_at = now() WHERE id = ?", revoked.id)
        val deletedCustomer = ledger().customer(w.shopId)
        val deleted = links.issue(w.shopId, deletedCustomer, w.owner.id, now = clock.instant())
        ledger().deleteCustomer(w.shopId, deletedCustomer)
        val unknown =
            java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                ByteArray(32).also(java.security.SecureRandom()::nextBytes),
            )
        val responses = listOf(expired.token, revoked.token, deleted.token, "bad", unknown).map { open(it) }
        responses.forEach { assertEquals(404, it.status) }
        val bodies = responses.map { it.contentAsString.replace(Regex("nonce=\"[^\"]*\""), "nonce=\"\"") }
        assertEquals(1, bodies.toSet().size)
        assertTrue(bodies.first().contains("Hesap dökümü bulunamadı"))
    }

    @Test
    fun `sixty first request from an address is limited`() {
        val ip = UUID.randomUUID().toString()
        repeat(60) { assertEquals(404, open("bad", ip).status) }
        val response = open("bad", ip)
        assertEquals(429, response.status)
        assertNotNull(response.getHeader("Retry-After"))
    }

    @Test
    fun `deleted shop cannot expose its statement`() {
        val w = world()
        val c = ledger().customer(w.shopId)
        val link = links.issue(w.shopId, c, w.owner.id, now = clock.instant())
        jdbc.update("UPDATE shops SET deleted_at = now() WHERE id = ?", w.shopId)
        assertEquals(404, open(link.token).status)
        assertEquals(0, jdbc.queryForObject("SELECT open_count FROM statement_links WHERE id = ?", Int::class.java, link.id))
    }
}
