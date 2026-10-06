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
        val name = "😀".repeat(41)
        assertEquals(
            "Sayın ${"😀".repeat(40)}, Shop defterinizdeki güncel borcunuz -₺12,00. Hesap dökümü: link",
            ReminderTemplates.balance(name, "Shop", -1200, "link"),
        )
    }
}
