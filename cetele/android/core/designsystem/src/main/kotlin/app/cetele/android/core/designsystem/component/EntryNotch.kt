@file:Suppress("MatchingDeclarationName")

package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTheme

/** How an entry is marked in the notch column of the ledger. */
enum class NotchKind {
    Debt,
    Payment,
    Reversed,
    Correction,
}

/** The tally notch of an entry; decorative, the kind is also written out in the row. */
@Composable
fun EntryNotch(
    kind: NotchKind,
    modifier: Modifier = Modifier,
) {
    val colors = CeteleTheme.colors
    val color =
        when (kind) {
            NotchKind.Debt -> colors.debtMark
            NotchKind.Payment -> colors.paymentMark
            NotchKind.Reversed -> colors.borderStrong
            NotchKind.Correction -> colors.accentText
        }
    Canvas(modifier.size(CeteleSpacing.notchWidth, CeteleSpacing.notchHeight).clearAndSetSemantics {}) {
        val stroke = CeteleSpacing.notchStroke.toPx()
        val radius = CornerRadius(stroke / 2, stroke / 2)
        val left = (size.width - stroke) / 2
        when (kind) {
            NotchKind.Debt, NotchKind.Payment -> {
                drawRoundRect(color, Offset(left, 0f), Size(stroke, size.height), radius)
            }

            NotchKind.Reversed -> {
                val inset = stroke / 2
                drawRoundRect(
                    color,
                    Offset(left + inset / 2, inset / 2),
                    Size(stroke - inset, size.height - inset),
                    radius,
                    style = Stroke(width = inset),
                )
            }

            NotchKind.Correction -> {
                drawLine(
                    color,
                    Offset(stroke / 2, size.height - stroke / 2),
                    Offset(size.width - stroke / 2, stroke / 2),
                    stroke,
                    StrokeCap.Round,
                )
            }
        }
    }
}
