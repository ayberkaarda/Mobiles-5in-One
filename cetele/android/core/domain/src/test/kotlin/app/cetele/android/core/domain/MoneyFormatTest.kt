package app.cetele.android.core.domain

import app.cetele.android.core.domain.format.MoneyFormat
import app.cetele.android.core.domain.validation.Limits
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class MoneyFormatTest {
    @Test
    fun `formats Turkish lira with explicit sign and separators`() {
        assertEquals("₺1.250,00", MoneyFormat.format(125000))
        assertEquals("-₺12,00", MoneyFormat.format(-1200))
        assertEquals("₺0,00", MoneyFormat.format(0))
        assertEquals("₺0,01", MoneyFormat.format(1))
        assertEquals("-₺92.233.720.368.547.758,08", MoneyFormat.format(Long.MIN_VALUE))
    }

    @Test
    fun `parses keypad and grouped amounts in minor units`() {
        assertEquals(125000L, MoneyFormat.parse("1.250,00"))
        assertEquals(125000L, MoneyFormat.parse("1250"))
        assertEquals(125050L, MoneyFormat.parse("1250,5"))
        assertEquals(5L, MoneyFormat.parse("0,05"))
        for (minor in listOf(0L, 1L, 99L, 100L, 125050L, Limits.AMOUNT_MAX)) {
            assertEquals(minor, MoneyFormat.parse(MoneyFormat.format(minor)))
        }
    }

    @Test
    fun `rejects malformed negative fractional overflow and excessive amounts`() {
        val invalid =
            listOf(
                "",
                " ",
                "-1",
                "-₺12,00",
                "+1",
                "1,234",
                "1,",
                ",5",
                "1.25",
                "1..250",
                "1e3",
                "12 50",
                "١٢",
                "100000000,01",
                "999999999999999999999999999999999999",
            )
        invalid.forEach { assertNull(MoneyFormat.parse(it), it) }
    }
}
