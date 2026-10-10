package app.cetele.android.core.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class CeteleColorsTokenTest {
    @Test
    fun `light roles equal the brand tokens`() {
        assertScheme("light", LightCeteleColors)
    }

    @Test
    fun `dark roles equal the brand tokens`() {
        assertScheme("dark", DarkCeteleColors)
    }

    private fun assertScheme(
        scheme: String,
        colors: CeteleColors,
    ) {
        val tokens = BrandTokens.obj("color", "scheme", scheme)
        val actual = colors.byRole()

        assertEquals(tokens.keys, actual.keys, "role names in $scheme")
        tokens.forEach { (role, value) ->
            assertEquals(value.jsonPrimitive.content, actual.getValue(role).toTokenHex(), "$scheme.$role")
        }
    }

    /** Token notation: #RRGGBB, or #RRGGBBAA when not opaque (alpha last). */
    private fun Color.toTokenHex(): String {
        val argb = toArgb()
        val alpha = (argb ushr ALPHA_SHIFT) and BYTE_MASK
        val rgb = "#%06X".format(argb and RGB_MASK)
        return if (alpha == BYTE_MASK) rgb else rgb + "%02X".format(alpha)
    }

    private fun CeteleColors.byRole(): Map<String, Color> =
        mapOf(
            "background" to background,
            "surface" to surface,
            "surfaceRaised" to surfaceRaised,
            "surfaceSunken" to surfaceSunken,
            "text" to text,
            "textMuted" to textMuted,
            "border" to border,
            "borderStrong" to borderStrong,
            "primary" to primary,
            "onPrimary" to onPrimary,
            "primaryText" to primaryText,
            "secondary" to secondary,
            "onSecondary" to onSecondary,
            "accent" to accent,
            "onAccent" to onAccent,
            "accentText" to accentText,
            "debt" to debt,
            "onDebt" to onDebt,
            "debtText" to debtText,
            "debtMark" to debtMark,
            "payment" to payment,
            "onPayment" to onPayment,
            "paymentText" to paymentText,
            "paymentMark" to paymentMark,
            "error" to error,
            "onError" to onError,
            "errorText" to errorText,
            "focusRing" to focusRing,
            "overlay" to overlay,
        )

    private companion object {
        const val ALPHA_SHIFT = 24
        const val BYTE_MASK = 0xFF
        const val RGB_MASK = 0xFFFFFF
    }
}
