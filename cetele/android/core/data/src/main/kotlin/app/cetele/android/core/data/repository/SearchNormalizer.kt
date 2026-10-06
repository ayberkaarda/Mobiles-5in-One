package app.cetele.android.core.data.repository

import java.text.Normalizer
import java.util.Locale

object SearchNormalizer {
    private val TURKISH: Locale = Locale.forLanguageTag("tr")

    fun normalize(text: String): String =
        Normalizer
            .normalize(text.lowercase(TURKISH), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .trim()
            .replace(Regex("\\s+"), " ")

    fun query(text: String): String = normalize(text).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
}
