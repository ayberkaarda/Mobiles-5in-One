package app.cetele.android.core.designsystem

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/** Manrope 700, display family: only at 20 sp and above. */
val Manrope: FontFamily = FontFamily(Font(R.font.manrope_bold, FontWeight.Bold))

/** Inter 400/500/600, body family. */
val Inter: FontFamily =
    FontFamily(
        Font(R.font.inter_regular, FontWeight.Normal),
        Font(R.font.inter_medium, FontWeight.Medium),
        Font(R.font.inter_semibold, FontWeight.SemiBold),
    )

/** Tabular figures so columns of kuruş line up. */
const val TABULAR_FIGURES: String = "tnum"

private fun display(
    size: Int,
    lineHeight: Int,
    tracking: Float = 0f,
) = TextStyle(
    fontFamily = Manrope,
    fontWeight = FontWeight.Bold,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    letterSpacing = tracking.em,
)

private fun body(
    weight: FontWeight,
    size: Int,
    lineHeight: Int,
    tracking: Float = 0f,
) = TextStyle(
    fontFamily = Inter,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    letterSpacing = tracking.em,
)

/** Brand type scale (`typography.scale` in the brand tokens), app sizes in sp. */
object CeteleTextStyles {
    val display: TextStyle = display(size = 32, lineHeight = 40, tracking = -0.01f)
    val headline: TextStyle = display(size = 26, lineHeight = 32)
    val title: TextStyle = display(size = 20, lineHeight = 28)
    val titleSmall: TextStyle = body(FontWeight.SemiBold, size = 18, lineHeight = 24)
    val bodyLarge: TextStyle = body(FontWeight.Normal, size = 18, lineHeight = 28)
    val body: TextStyle = body(FontWeight.Normal, size = 16, lineHeight = 24)
    val bodyStrong: TextStyle = body(FontWeight.SemiBold, size = 16, lineHeight = 24)
    val label: TextStyle = body(FontWeight.SemiBold, size = 16, lineHeight = 24)
    val caption: TextStyle = body(FontWeight.Medium, size = 14, lineHeight = 20, tracking = 0.01f)

    /** Amounts in ledger rows and lists. */
    val amount: TextStyle =
        body(FontWeight.SemiBold, size = 18, lineHeight = 24).copy(fontFeatureSettings = TABULAR_FIGURES)

    /** Customer balance and the shop total. */
    val amountLarge: TextStyle =
        display(size = 36, lineHeight = 44, tracking = -0.01f).copy(fontFeatureSettings = TABULAR_FIGURES)
}

/** Material 3 slots filled from the brand scale (the `m3` field of each token style). */
val CeteleTypography: Typography =
    Typography(
        displayLarge = CeteleTextStyles.display,
        displayMedium = CeteleTextStyles.display,
        displaySmall = CeteleTextStyles.display,
        headlineLarge = CeteleTextStyles.headline,
        headlineMedium = CeteleTextStyles.headline,
        headlineSmall = CeteleTextStyles.headline,
        titleLarge = CeteleTextStyles.title,
        titleMedium = CeteleTextStyles.titleSmall,
        titleSmall = CeteleTextStyles.bodyStrong,
        bodyLarge = CeteleTextStyles.body,
        bodyMedium = CeteleTextStyles.body,
        bodySmall = CeteleTextStyles.caption,
        labelLarge = CeteleTextStyles.label,
        labelMedium = CeteleTextStyles.caption,
        labelSmall = CeteleTextStyles.caption,
    )
