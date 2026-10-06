package app.cetele.server.reminders.template

import app.cetele.server.ledger.money.MoneyFormat

object ReminderTemplates {
    fun balance(
        customerName: String,
        shopName: String,
        balanceMinor: Long,
        url: String,
    ): String =
        "Sayın ${name(
            customerName,
        )}, ${name(shopName)} defterinizdeki güncel borcunuz ${MoneyFormat.format(balanceMinor)}. Hesap dökümü: $url"

    private fun name(value: String): String {
        val clean = value.filterNot { Character.isISOControl(it) || Character.getType(it) == Character.FORMAT.toInt() }.trim()
        val count = clean.codePointCount(0, clean.length).coerceAtMost(40)
        return clean.substring(0, clean.offsetByCodePoints(0, count))
    }
}
