package app.cetele.android.feature.reminders

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

class ReminderTemplatesTest {
    @Test
    fun messageUsesExactCopyAndTurkishMoney() {
        assertEquals(
            "Sayın Ayşe, Köşe Bakkalı defterinizdeki güncel borcunuz ₺1.250,00. " +
                "Hesap dökümünüz: https://cetele.app/s/example",
            ReminderTemplates.whatsapp(" Ayşe ", " Köşe Bakkalı ", 125000, "https://cetele.app/s/example"),
        )
    }

    @Test
    fun namesAreCleanedBeforeClipping() {
        val text =
            ReminderTemplates.whatsapp(
                "\n " + "a".repeat(45) + "\r",
                "\t " + "b".repeat(45),
                1,
                "https://cetele.app/s/example",
            )
        assertEquals(
            "Sayın ${"a".repeat(40)}, ${"b".repeat(40)} defterinizdeki güncel borcunuz ₺0,01. " +
                "Hesap dökümünüz: https://cetele.app/s/example",
            text,
        )
        assertFalse(text.any(Char::isISOControl))
    }

    @Test
    fun controlsAreRemovedAndNegativeAndZeroAmountsAreFormatted() {
        assertEquals(
            "Sayın Ali, Dükkan defterinizdeki güncel borcunuz -₺12,00. Hesap dökümünüz: link",
            ReminderTemplates.whatsapp("Al\u0000i", "Dük\u007fkan", -1200, "link"),
        )
        assertEquals(
            "Sayın Ali, Dükkan defterinizdeki güncel borcunuz ₺0,00. Hesap dökümünüz: link",
            ReminderTemplates.whatsapp("Ali", "Dükkan", 0, "link"),
        )
    }
}
