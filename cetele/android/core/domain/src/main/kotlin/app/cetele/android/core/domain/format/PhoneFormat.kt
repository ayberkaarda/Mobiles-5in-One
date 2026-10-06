package app.cetele.android.core.domain.format

import app.cetele.android.core.domain.validation.PhoneValidator

object PhoneFormat {
    private const val PREFIX_END = 3
    private const val GROUP_END = 6
    private const val PAIR_END = 8
    private val separators = Regex("[\\s-]")

    fun toE164Tr(input: String): String? {
        val compact = input.replace(separators, "")
        val e164 =
            when {
                compact.startsWith("+90") -> compact
                compact.startsWith("0") -> "+90" + compact.drop(1)
                compact.startsWith("5") -> "+90$compact"
                else -> return null
            }
        return e164.takeIf(PhoneValidator::isValid)
    }

    fun display(e164: String): String {
        require(PhoneValidator.isValid(e164)) { "Invalid Turkish mobile phone" }
        val national = e164.removePrefix("+90")
        return listOf(
            "0",
            national.take(PREFIX_END),
            national.substring(PREFIX_END, GROUP_END),
            national.substring(GROUP_END, PAIR_END),
            national.takeLast(2),
        ).joinToString(" ")
    }

    fun masked(e164: String): String {
        require(PhoneValidator.isValid(e164)) { "Invalid Turkish mobile phone" }
        return "+90*******${e164.takeLast(2)}"
    }
}
