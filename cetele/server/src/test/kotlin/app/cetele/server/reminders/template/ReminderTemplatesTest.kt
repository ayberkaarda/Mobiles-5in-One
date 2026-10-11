package app.cetele.server.reminders.template

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class ReminderTemplatesTest {
    @Test
    fun `balance renders the Turkish template with formatted money and statement URL`() {
        assertEquals(
            "Sayın Ayşe Yılmaz, Yıldız Bakkal defterinizdeki güncel borcunuz ₺1.250,00. Hesap dökümü: https://example.test/s/test",
            ReminderTemplates.balance(" Ayşe Yılmaz ", " Yıldız Bakkal ", 125_000, "https://example.test/s/test"),
        )
    }

    @Test
    fun `names are trimmed stripped of controls and clipped to forty characters`() {
        val text = ReminderTemplates.balance(" \u0000\n" + "ş".repeat(45) + "\r ", "\t" + "Ç".repeat(42) + "\u202E", 1, "link")
        assertEquals("Sayın ${"ş".repeat(40)}, ${"Ç".repeat(40)} defterinizdeki güncel borcunuz ₺0,01. Hesap dökümü: link", text)
        assertFalse(text.any { Character.isISOControl(it) })
    }

    @Test
    fun `clipping does not split a supplementary character`() {
        val name = "𐐀".repeat(41)
        assertEquals(
            "Sayın ${"𐐀".repeat(40)}, Shop defterinizdeki güncel borcunuz -₺12,00. Hesap dökümü: link",
            ReminderTemplates.balance(name, "Shop", -1200, "link"),
        )
    }

    @Test
    fun `names cannot insert URLs email addresses or phone numbers`() {
        listOf(
            "evil.com/x" to "evil com x",
            "https://a.b" to "https a b",
            "a@b.co" to "a b co",
            "Ali 0532 123 45 67" to "Ali",
            "Ali ٠٥٣٢ ١٢٣ ٤٥ ٦٧" to "Ali",
        ).forEach { (input, expected) ->
            val text = ReminderTemplates.balance(input, input, 1, "link")
            assertEquals(
                "Sayın $expected, $expected defterinizdeki güncel borcunuz ₺0,01. Hesap dökümü: link",
                text,
            )
        }
    }

    @Test
    fun `empty filtered names use neutral phrases`() {
        assertEquals(
            "Sayın müşterimiz, dükkânınız defterinizdeki güncel borcunuz ₺0,01. Hesap dökümü: link",
            ReminderTemplates.balance("😀@./:", "0532 123 45 67", 1, "link"),
        )
    }

    @Test
    fun `Turkish letters permitted punctuation and fewer than seven digits remain`() {
        assertEquals(
            "Sayın Ayşe O'Çınar, Şığ & Öü-123456 defterinizdeki güncel borcunuz ₺0,01. Hesap dökümü: link",
            ReminderTemplates.balance("Ayşe O'Çınar", "Şığ & Öü-123456", 1, "link"),
        )
        assertEquals(
            "Sayın Ali, Ali defterinizdeki güncel borcunuz ₺0,01. Hesap dökümü: link",
            ReminderTemplates.balance("Ali1234567", "Ali1234567", 1, "link"),
        )
    }
}
