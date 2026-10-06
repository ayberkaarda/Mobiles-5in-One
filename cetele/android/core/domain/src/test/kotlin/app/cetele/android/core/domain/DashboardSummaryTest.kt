package app.cetele.android.core.domain

import app.cetele.android.core.domain.ledger.DashboardSummary
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DashboardSummaryTest {
    @Test
    fun `totals ignore deleted orphaned reversed and reversal entries`() {
        val customers = listOf(customer(), customer("credit"), customer("deleted", deletedAt = createdAt))
        val entries =
            listOf(
                entry("debt", amountMinor = 2000, dueOn = today),
                entry("payment", type = EntryType.PAYMENT, amountMinor = 500),
                entry("old", amountMinor = 1000, occurredOn = today.minusDays(1)),
                entry("credit", customerId = "credit", type = EntryType.PAYMENT, amountMinor = 900),
                entry("deleted", customerId = "deleted", amountMinor = 8000),
                entry("orphan", customerId = "missing", amountMinor = 8000),
                entry("wrong-shop", shopId = "other-shop", amountMinor = 8000),
                entry("reversed", reversedBy = "correction", dueOn = today),
                entry("correction", reverses = "reversed"),
            )
        val summary = DashboardSummary.compute(customers, entries, today)
        assertEquals(Money(2000), summary.todayDebt)
        assertEquals(Money(1400), summary.todayPayment)
        assertEquals(Money(2500), summary.totalReceivable)
        assertEquals(listOf("customer-one"), summary.topDebtors.map { it.customerId })
        assertEquals(listOf("debt"), summary.dueToday.map { it.entry.id })
        assertEquals(Money(2500), summary.dueToday.single().balance)
        assertEquals("Ayşe", summary.dueToday.single().customerName)
    }

    @Test
    fun `top ten sort by balance and exclude zero and credit balances`() {
        val customers = (0..12).map { customer("customer-$it", "Name $it") }
        val entries = (1..12).map { entry("entry-$it", "customer-$it", amountMinor = it * 100L) }
        val summary = DashboardSummary.compute(customers, entries, today)
        assertEquals((12 downTo 3).map { "customer-$it" }, summary.topDebtors.map { it.customerId })
        assertEquals(Money(7800), summary.totalReceivable)
    }

    @Test
    fun `paid customers are absent from due reminders`() {
        val entries = listOf(entry("due", dueOn = today), entry("paid", type = EntryType.PAYMENT))
        assertTrue(DashboardSummary.compute(listOf(customer()), entries, today).dueToday.isEmpty())
        val empty = DashboardSummary.compute(emptyList(), emptyList(), today)
        assertEquals(Money.ZERO, empty.todayDebt)
        assertEquals(Money.ZERO, empty.todayPayment)
        assertEquals(Money.ZERO, empty.totalReceivable)
        assertTrue(empty.topDebtors.isEmpty())
        assertTrue(empty.dueToday.isEmpty())
    }
}
