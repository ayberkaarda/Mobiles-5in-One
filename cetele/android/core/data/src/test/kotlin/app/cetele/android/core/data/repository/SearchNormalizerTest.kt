package app.cetele.android.core.data.repository

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class SearchNormalizerTest {
    @Test fun turkishCaseDiacriticsAndWhitespace() {
        assertEquals("istanbul ısparta sener guler", SearchNormalizer.normalize("  İstanbul  Isparta Şener Ğüler  "))
        assertEquals("ı", SearchNormalizer.normalize("ı"))
        assertEquals("i", SearchNormalizer.normalize("İ"))
        assertEquals("\\%\\_", SearchNormalizer.query("%_"))
    }
}
