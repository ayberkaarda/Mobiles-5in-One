package app.cetele.android.core.designsystem

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * Colour roles of the Çetele brand (`cetele/brand/tokens.json`, `color.scheme`). Role names and values match
 * the tokens one to one; `CeteleColorsTokenTest` fails when they drift apart.
 */
@Immutable
data class CeteleColors(
    val background: Color,
    val surface: Color,
    val surfaceRaised: Color,
    val surfaceSunken: Color,
    val text: Color,
    val textMuted: Color,
    val border: Color,
    val borderStrong: Color,
    val primary: Color,
    val onPrimary: Color,
    val primaryText: Color,
    val secondary: Color,
    val onSecondary: Color,
    val accent: Color,
    val onAccent: Color,
    val accentText: Color,
    val debt: Color,
    val onDebt: Color,
    val debtText: Color,
    val debtMark: Color,
    val payment: Color,
    val onPayment: Color,
    val paymentText: Color,
    val paymentMark: Color,
    val error: Color,
    val onError: Color,
    val errorText: Color,
    val focusRing: Color,
    val overlay: Color,
)

val LightCeteleColors: CeteleColors =
    CeteleColors(
        background = Color(0xFFEDEAE4),
        surface = Color(0xFFFAF7F0),
        surfaceRaised = Color(0xFFFFFFFF),
        surfaceSunken = Color(0xFFE8E4DC),
        text = Color(0xFF1A1A1A),
        textMuted = Color(0xFF575D69),
        border = Color(0xFFE0D8C7),
        borderStrong = Color(0xFF6B7280),
        primary = Color(0xFF1E2A5A),
        onPrimary = Color(0xFFFAF7F0),
        primaryText = Color(0xFF1E2A5A),
        secondary = Color(0xFFE2E5EF),
        onSecondary = Color(0xFF1E2A5A),
        accent = Color(0xFFE8712B),
        onAccent = Color(0xFF1A1A1A),
        accentText = Color(0xFFA84716),
        debt = Color(0xFFC0392B),
        onDebt = Color(0xFFFFFFFF),
        debtText = Color(0xFFA8301F),
        debtMark = Color(0xFFC0392B),
        payment = Color(0xFF24704A),
        onPayment = Color(0xFFFFFFFF),
        paymentText = Color(0xFF24704A),
        paymentMark = Color(0xFF2E8B57),
        error = Color(0xFFC0392B),
        onError = Color(0xFFFFFFFF),
        errorText = Color(0xFFA8301F),
        focusRing = Color(0xFFA84716),
        overlay = Color(0x990E1325),
    )

val DarkCeteleColors: CeteleColors =
    CeteleColors(
        background = Color(0xFF0E1325),
        surface = Color(0xFF151B31),
        surfaceRaised = Color(0xFF1D2440),
        surfaceSunken = Color(0xFF090D1B),
        text = Color(0xFFFAF7F0),
        textMuted = Color(0xFFA7AEBF),
        border = Color(0xFF2A3250),
        borderStrong = Color(0xFF6B7280),
        primary = Color(0xFFAFBBEB),
        onPrimary = Color(0xFF1E2A5A),
        primaryText = Color(0xFFAFBBEB),
        secondary = Color(0xFF262E4D),
        onSecondary = Color(0xFFFAF7F0),
        accent = Color(0xFFE8712B),
        onAccent = Color(0xFF1A1A1A),
        accentText = Color(0xFFF4A06C),
        debt = Color(0xFFEB6F60),
        onDebt = Color(0xFF0E1325),
        debtText = Color(0xFFEB6F60),
        debtMark = Color(0xFFEB6F60),
        payment = Color(0xFF5CC08A),
        onPayment = Color(0xFF0E1325),
        paymentText = Color(0xFF5CC08A),
        paymentMark = Color(0xFF2E8B57),
        error = Color(0xFFEB6F60),
        onError = Color(0xFF0E1325),
        errorText = Color(0xFFEB6F60),
        focusRing = Color(0xFFE8712B),
        overlay = Color(0xB3000000),
    )

/**
 * The ledger cover: the Defter Lacivert block that carries the key figure of a screen (shop total, customer
 * balance) in both schemes, like the navy hardcover of a veresiye defteri. It is a dark surface, so its text uses
 * the dark roles: Kâğıt 12.79, Gece Muted 6.16, Ödendi Açık 6.10 and Borç Açık 4.55 to 1 on Defter Lacivert.
 */
@Immutable
data class CoverColors(
    val container: Color,
    val content: Color,
    val contentMuted: Color,
    val debt: Color,
    val payment: Color,
    val rule: Color,
    val edge: Color,
    val notch: Color,
)

/** Cover roles derived from the scheme roles; nothing here is a new colour value. */
fun coverColors(dark: Boolean): CoverColors {
    val night = DarkCeteleColors
    return CoverColors(
        container = LightCeteleColors.primary,
        content = night.text,
        contentMuted = night.textMuted,
        debt = night.debtText,
        payment = night.paymentText,
        rule = night.text.copy(alpha = COVER_RULE_ALPHA),
        edge = if (dark) night.border else Color.Transparent,
        notch = night.accent,
    )
}

private const val COVER_RULE_ALPHA = 0.16f
