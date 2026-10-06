package app.cetele.server.ledger.money

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class MoneyFormatTest {
    @Test
    fun `Turkish currency format preserves integer minor units`() {
        assertEquals("₺1.250,00", MoneyFormat.format(125_000))
        assertEquals("-₺12,00", MoneyFormat.format(-1200))
        assertEquals("₺0,01", MoneyFormat.format(1))
        assertEquals("₺0,00", MoneyFormat.format(0))
        assertEquals("₺100.000.000,00", MoneyFormat.format(10_000_000_000))
        assertEquals("-₺92.233.720.368.547.758,08", MoneyFormat.format(Long.MIN_VALUE))
    }
}
