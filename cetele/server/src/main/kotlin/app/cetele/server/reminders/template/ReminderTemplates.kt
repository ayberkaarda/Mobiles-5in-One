package app.cetele.server.reminders.template

import app.cetele.server.ledger.money.MoneyFormat

object ReminderTemplates {
    fun balance(
        customerName: String,
        shopName: String,
        balanceMinor: Long,
        url: String,
    ): String =
        "${name(customerName, "Sayın müşterimiz", "Sayın ")}, " +
            "${name(shopName, "dükkânınız")} defterinizdeki güncel borcunuz ${MoneyFormat.format(balanceMinor)}. Hesap dökümü: $url"

    private fun name(
        value: String,
        fallback: String,
        prefix: String = "",
    ): String {
        val points = value.codePoints().toArray()
        val dropDigits = points.count { Character.isDigit(it) } >= 7
        val clean =
            buildString {
                points.forEach { point ->
                    when {
                        Character.isDigit(point) && dropDigits -> append(' ')
                        Character.isLetterOrDigit(point) || point in ALLOWED_PUNCTUATION -> appendCodePoint(point)
                        else -> append(' ')
                    }
                }
            }.replace(Regex(" +"), " ").trim()
        if (clean.isEmpty()) return fallback
        val count = clean.codePointCount(0, clean.length).coerceAtMost(40)
        return prefix + clean.substring(0, clean.offsetByCodePoints(0, count)).trimEnd()
    }

    private val ALLOWED_PUNCTUATION = setOf(' '.code, '\''.code, '&'.code, '-'.code)
}
