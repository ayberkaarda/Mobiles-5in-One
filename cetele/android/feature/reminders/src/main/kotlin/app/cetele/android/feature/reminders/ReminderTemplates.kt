package app.cetele.android.feature.reminders

import app.cetele.android.core.domain.format.MoneyFormat

object ReminderTemplates {
    private const val NAME_LIMIT = 40

    fun whatsapp(
        customerName: String,
        shopName: String,
        balanceMinor: Long,
        url: String,
    ): String =
        "Sayın ${cleanName(customerName)}, ${cleanName(shopName)} defterinizdeki güncel borcunuz " +
            "${MoneyFormat.format(balanceMinor)}. Hesap dökümünüz: $url"

    private fun cleanName(value: String): String = value.filterNot(Char::isISOControl).trim().take(NAME_LIMIT)
}
