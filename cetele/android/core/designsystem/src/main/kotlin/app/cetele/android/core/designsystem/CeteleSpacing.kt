package app.cetele.android.core.designsystem

import androidx.compose.ui.unit.dp

object CeteleSpacing {
    val none = 0.dp
    val extraSmall = 4.dp
    val small = 8.dp
    val medium = 12.dp
    val regular = 16.dp
    val large = 20.dp
    val extraLarge = 24.dp
    val spacious = 32.dp
    val wide = 40.dp
    val touchTarget = 48.dp
    val rowMinHeight = 64.dp
    val screenGutter = regular
    val fabSize = 56.dp

    val scale =
        mapOf(
            "0" to none,
            "1" to extraSmall,
            "2" to small,
            "3" to medium,
            "4" to regular,
            "5" to large,
            "6" to extraLarge,
            "8" to spacious,
            "10" to wide,
            "12" to touchTarget,
            "16" to rowMinHeight,
        )
}
