package app.cetele.android.core.domain

import app.cetele.android.core.domain.format.DateFormats
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.time.LocalDate
import java.time.YearMonth
import java.util.Locale

class DateFormatsTest {
    @Test
    fun `formats dates independently of default locale`() {
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale.US)
            assertEquals("6 Ekim 2026", DateFormats.long(today))
            assertEquals("06.10.2026", DateFormats.short(today))
            assertEquals("Ekim 2026", DateFormats.monthYear(YearMonth.of(2026, 10)))
            assertEquals("29.02.2024", DateFormats.short(LocalDate.of(2024, 2, 29)))
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test
    fun `all twelve Turkish months are fixed`() {
        val expected =
            listOf(
                "Ocak",
                "Şubat",
                "Mart",
                "Nisan",
                "Mayıs",
                "Haziran",
                "Temmuz",
                "Ağustos",
                "Eylül",
                "Ekim",
                "Kasım",
                "Aralık",
            )
        expected.forEachIndexed { index, name ->
            assertEquals("$name 2026", DateFormats.monthYear(YearMonth.of(2026, index + 1)))
        }
    }
}
