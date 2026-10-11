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

    /** Component sizes on the 4-pt grid (not part of the spacing scale). */
    val buttonHeight = 52.dp
    val keyHeight = 60.dp
    val avatar = 44.dp
    val notchWidth = 16.dp
    val notchHeight = 28.dp
    val notchStroke = 4.dp
    val pinDot = 16.dp
    val hairline = 1.dp
    val navRowHeight = 56.dp
    val iconBadge = 64.dp
    val brandMark = 48.dp

    /** Where the rule between list rows starts: past the avatar or notch, under the text column. */
    val listRuleInset = 72.dp
    val entryRuleInset = 44.dp

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
