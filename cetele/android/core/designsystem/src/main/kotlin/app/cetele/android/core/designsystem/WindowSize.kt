package app.cetele.android.core.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.dp

/**
 * True on short windows (small phones, split screen, large font with display zoom): PIN and sign-in pages
 * drop the mark and use smaller keys so the whole keypad stays on screen without scrolling.
 */
@Composable
@ReadOnlyComposable
fun isCompactHeight(): Boolean {
    val height =
        with(LocalDensity.current) {
            LocalWindowInfo.current.containerSize.height
                .toDp()
        }
    return height < COMPACT_HEIGHT
}

private val COMPACT_HEIGHT = 640.dp
