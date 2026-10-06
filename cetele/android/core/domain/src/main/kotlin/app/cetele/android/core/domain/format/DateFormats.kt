package app.cetele.android.core.domain.format

import java.time.LocalDate
import java.time.YearMonth

object DateFormats {
    private const val YEAR_WIDTH = 4
    private val months =
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

    fun long(date: LocalDate): String = "${date.dayOfMonth} ${months[date.monthValue - 1]} ${date.year}"

    fun short(date: LocalDate): String =
        "${date.dayOfMonth.toString().padStart(2, '0')}.${date.monthValue.toString().padStart(2, '0')}." +
            date.year.toString().padStart(YEAR_WIDTH, '0')

    fun monthYear(month: YearMonth): String = "${months[month.monthValue - 1]} ${month.year}"
}
