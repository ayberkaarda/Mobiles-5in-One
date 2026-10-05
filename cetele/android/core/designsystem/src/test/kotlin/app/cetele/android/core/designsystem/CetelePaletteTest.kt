package app.cetele.android.core.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.pow

class CetelePaletteTest {
    @Test
    fun `core colours match the product specification`() {
        assertEquals("1E2A5A", CetelePalette.DefterLacivert.hex())
        assertEquals("E8712B", CetelePalette.CentikTuruncu.hex())
        assertEquals("FAF7F0", CetelePalette.Kagit.hex())
        assertEquals("1A1A1A", CetelePalette.Murekkep.hex())
        assertEquals("2E8B57", CetelePalette.OdendiYesili.hex())
        assertEquals("C0392B", CetelePalette.BorcKirmizisi.hex())
        assertEquals("6B7280", CetelePalette.Kursun.hex())
    }

    @Test
    fun `text pairs used by the theme reach WCAG AA contrast`() {
        assertTrue(contrast(CetelePalette.Murekkep, CetelePalette.Kagit) >= TEXT_MIN)
        assertTrue(contrast(CetelePalette.Kagit, CetelePalette.DefterLacivert) >= TEXT_MIN)
        assertTrue(contrast(CetelePalette.Kursun, CetelePalette.Kagit) >= TEXT_MIN)
        assertTrue(contrast(CetelePalette.White, CetelePalette.BorcKirmizisi) >= TEXT_MIN)
    }

    private fun Color.hex(): String = "%06X".format(toArgb() and RGB_MASK)

    private fun contrast(
        foreground: Color,
        background: Color,
    ): Float {
        val lighter = maxOf(foreground.luminanceOf(), background.luminanceOf())
        val darker = minOf(foreground.luminanceOf(), background.luminanceOf())
        return (lighter + FLARE) / (darker + FLARE)
    }

    private fun Color.luminanceOf(): Float =
        LUMA_RED * channel(red) + LUMA_GREEN * channel(green) + LUMA_BLUE * channel(blue)

    private fun channel(value: Float): Float =
        if (value <= LINEAR_THRESHOLD) {
            value / LINEAR_DIVISOR
        } else {
            ((value + GAMMA_OFFSET) / GAMMA_DIVISOR).pow(GAMMA)
        }

    private companion object {
        const val RGB_MASK = 0xFFFFFF
        const val TEXT_MIN = 4.5f
        const val FLARE = 0.05f
        const val LUMA_RED = 0.2126f
        const val LUMA_GREEN = 0.7152f
        const val LUMA_BLUE = 0.0722f
        const val LINEAR_THRESHOLD = 0.04045f
        const val LINEAR_DIVISOR = 12.92f
        const val GAMMA_OFFSET = 0.055f
        const val GAMMA_DIVISOR = 1.055f
        const val GAMMA = 2.4f
    }
}
