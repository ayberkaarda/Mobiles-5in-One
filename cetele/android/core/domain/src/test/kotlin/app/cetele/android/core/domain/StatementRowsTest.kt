package app.cetele.android.core.domain

import app.cetele.android.core.domain.ledger.StatementRows
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class StatementRowsTest {
    @Test
    fun `orders by business date then creation time and keeps active running balance`() {
        val debt = entry("debt", amountMinor = 2000, occurredOn = today.minusDays(1))
        val payment = entry("payment", type = EntryType.PAYMENT, amountMinor = 500, created = createdAt.plusSeconds(1))
        val extra = entry("extra", amountMinor = 100)
        val rows = StatementRows.build(listOf(payment, extra, debt))
        assertEquals(listOf("debt", "extra", "payment"), rows.map { it.entry.id })
        assertEquals(listOf(2000L, 2100L, 1600L), rows.map { it.runningBalance.minor })
        assertTrue(rows.none { it.struck || it.correctionOf != null })
    }

    @Test
    fun `strikes original and links correction without counting either`() {
        val original = entry("original", reversedBy = "correction")
        val correction = entry("correction", reverses = "original", created = createdAt.plusSeconds(1))
        val rows = StatementRows.build(listOf(correction, original))
        assertTrue(rows[0].struck)
        assertFalse(rows[1].struck)
        assertEquals("original", rows[1].correctionOf)
        assertEquals(listOf(Money.ZERO, Money.ZERO), rows.map { it.runningBalance })
        assertEquals(emptyList<Any>(), StatementRows.build(emptyList()))
    }

    @Test
    fun `ties have deterministic id order`() {
        assertEquals(listOf("a", "b"), StatementRows.build(listOf(entry("b"), entry("a"))).map { it.entry.id })
    }
}
