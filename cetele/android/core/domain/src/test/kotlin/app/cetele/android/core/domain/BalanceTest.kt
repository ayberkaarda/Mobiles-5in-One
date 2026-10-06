package app.cetele.android.core.domain

import app.cetele.android.core.domain.ledger.Balance
import app.cetele.android.core.domain.ledger.BalanceLine
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class BalanceTest {
    @Test
    fun `reversal pairs contribute zero for debt and payment`() {
        for (type in EntryType.entries) {
            val rows =
                listOf(
                    BalanceLine(type, 1250, reversedBy = "correction"),
                    BalanceLine(type, 1250, reverses = "original"),
                )
            assertEquals(Money.ZERO, Balance.of(rows))
        }
    }

    @Test
    fun `mixed debt and payment can produce a credit`() {
        val lines = listOf(BalanceLine(EntryType.DEBT, 1250), BalanceLine(EntryType.PAYMENT, 1500))
        assertEquals(Money(-250), Balance.of(lines))
        assertEquals(Money.ZERO, Balance.of(emptyList()))
    }

    @Test
    fun `aggregate overflow is refused`() {
        assertThrows<ArithmeticException> {
            Balance.of(listOf(BalanceLine(EntryType.DEBT, Long.MAX_VALUE), BalanceLine(EntryType.DEBT, 1)))
        }
    }
}
