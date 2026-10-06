package app.cetele.android.core.domain.format

import app.cetele.android.core.domain.validation.Limits
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale

object MoneyFormat {
    private const val FRACTION_DIGITS = 2
    private const val MINOR_PER_MAJOR = 100
    private val input = Regex("^(?:[0-9]+|[0-9]{1,3}(?:\\.[0-9]{3})+)(?:,[0-9]{1,2})?$")

    fun format(minor: Long): String {
        val number =
            NumberFormat.getNumberInstance(Locale.forLanguageTag("tr-TR")).apply {
                minimumFractionDigits = FRACTION_DIGITS
                maximumFractionDigits = FRACTION_DIGITS
            }
        val sign = if (minor < 0) "-" else ""
        return sign + "₺" + number.format(BigDecimal.valueOf(minor, FRACTION_DIGITS).abs())
    }

    fun parse(text: String): Long? {
        val normalized = text.trim().removePrefix("₺")
        if (!input.matches(normalized)) return null
        val parts = normalized.replace(".", "").split(',')
        return parts[0]
            .toLongOrNull()
            ?.takeIf { it <= Limits.AMOUNT_MAX / MINOR_PER_MAJOR }
            ?.let { major ->
                val fraction = if (parts.size == 2) parts[1].padEnd(FRACTION_DIGITS, '0').toLong() else 0L
                major * MINOR_PER_MAJOR + fraction
            }?.takeIf { it <= Limits.AMOUNT_MAX }
    }
}
