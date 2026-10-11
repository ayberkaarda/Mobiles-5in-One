package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.DarkCeteleColors
import app.cetele.android.core.designsystem.cetelePaintedMark

/**
 * The Çetele mark on the page: Defter Lacivert ink in light, Kâğıt ink in dark; the cedilla is always Çentik
 * Turuncu. Decorative: the screen title names the place.
 */
@Composable
fun BrandMark(
    modifier: Modifier = Modifier,
    height: Dp = CeteleSpacing.brandMark,
) {
    val colors = CeteleTheme.colors
    val ink = if (colors == DarkCeteleColors) colors.text else colors.primary
    val mark = remember(ink, colors.accent) { cetelePaintedMark(ink, colors.accent) }
    Icon(
        mark,
        contentDescription = null,
        tint = Color.Unspecified,
        modifier = modifier.size(width = height * MARK_ASPECT, height = height).clearAndSetSemantics {},
    )
}

/** Width over height of the mark's 48 x 64 view box. */
private const val MARK_ASPECT = 0.75f
