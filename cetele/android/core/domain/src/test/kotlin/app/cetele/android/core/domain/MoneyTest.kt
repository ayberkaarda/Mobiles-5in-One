package app.cetele.android.core.domain

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class MoneyTest {
    @Test
    fun `adds and subtracts in kurus`() {
        val total = Money.ofMinor(12_50) + Money.ofMinor(7_25) - Money.ofMinor(1_00)

        assertEquals(18_75L, total.minor)
        assertEquals("TRY", total.currency)
    }

    @Test
    fun `sums a list of amounts`() {
        val amounts = listOf(Money.ofMinor(100), Money.ofMinor(250), Money.ofMinor(-50))

        assertEquals(Money.ofMinor(300), Money.sum(amounts))
        assertEquals(Money.ZERO, Money.sum(emptyList()))
    }

    @Test
    fun `fails on overflow instead of wrapping`() {
        assertThrows<ArithmeticException> { Money.ofMinor(Long.MAX_VALUE) + Money.ofMinor(1) }
        assertThrows<ArithmeticException> { -Money.ofMinor(Long.MIN_VALUE) }
    }

    @Test
    fun `entry amount range matches the server validation`() {
        assertFalse(Money.ZERO.isValidEntryAmount())
        assertFalse(Money.ofMinor(-1).isValidEntryAmount())
        assertTrue(Money.ofMinor(1).isValidEntryAmount())
        assertTrue(Money.ofMinor(10_000_000_000L).isValidEntryAmount())
        assertFalse(Money.ofMinor(10_000_000_001L).isValidEntryAmount())
    }

    @Test
    fun `orders by amount`() {
        assertTrue(Money.ofMinor(1) < Money.ofMinor(2))
        assertTrue(Money.ofMinor(5).isPositive)
    }
}
