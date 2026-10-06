package app.cetele.server.ledger.money

import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale

object MoneyFormat {
    fun format(minor: Long): String {
        val amount = BigDecimal.valueOf(minor, 2)
        val format =
            NumberFormat.getNumberInstance(Locale.of("tr", "TR")).apply {
                minimumFractionDigits = 2
                maximumFractionDigits = 2
            }
        return (if (minor < 0) "-" else "") + "₺" + format.format(amount.abs())
    }
}
