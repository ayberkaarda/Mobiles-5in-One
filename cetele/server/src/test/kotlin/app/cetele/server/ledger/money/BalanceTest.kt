package app.cetele.server.ledger.money

import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class BalanceTest {
    @Test
    fun `debts add and payments subtract`() {
        assertEquals(0, Balance.of(emptyList()))
        assertEquals(8500, Balance.of(listOf(BalanceLine("DEBT", 12_500), BalanceLine("PAYMENT", 4000))))
        assertEquals(-4000, Balance.of(listOf(BalanceLine("PAYMENT", 4000))))
    }

    @Test
    fun `reversal pairs contribute zero for either type`() {
        listOf("DEBT", "PAYMENT").forEach { type ->
            val original = UUID.randomUUID()
            val reversal = UUID.randomUUID()
            assertEquals(
                200,
                Balance.of(
                    listOf(
                        BalanceLine(type, 5000, reversedBy = reversal),
                        BalanceLine(type, 5000, reverses = original),
                        BalanceLine("DEBT", 200),
                    ),
                ),
            )
        }
    }

    @Test
    fun `unknown types and overflow are refused`() {
        assertFailsWith<IllegalStateException> { Balance.of(listOf(BalanceLine("OTHER", 1))) }
        assertFailsWith<ArithmeticException> { Balance.of(listOf(BalanceLine("DEBT", Long.MAX_VALUE), BalanceLine("DEBT", 1))) }
    }
}
