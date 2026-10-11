package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.domain.model.Money

/**
 * The ledger cover: a Defter Lacivert block that carries the one figure a screen is about. [label] names the
 * figure, [amount] is shown large; [tone] colours it (debt, payment) with the cover's own text roles.
 * [content] holds what belongs to the figure (today's line, the two ledger actions).
 */
@Composable
fun LedgerCover(
    label: String,
    amount: Money,
    modifier: Modifier = Modifier,
    tone: AmountTone = AmountTone.Neutral,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val cover = CeteleTheme.cover
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = cover.container,
        contentColor = cover.content,
        border = BorderStroke(CeteleSpacing.hairline, cover.edge),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = CeteleSpacing.large, vertical = CeteleSpacing.large),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.extraSmall),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    label,
                    style = CeteleTextStyles.body,
                    color = cover.contentMuted,
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
                TallyMark(ink = cover.contentMuted, cross = cover.notch)
            }
            AmountText(
                amount,
                style = AmountStyle.Large,
                color =
                    when (tone) {
                        AmountTone.Debt -> cover.debt
                        AmountTone.Payment -> cover.payment
                        AmountTone.Neutral -> cover.content
                    },
            )
            if (content != null) {
                Column(
                    modifier = Modifier.padding(top = CeteleSpacing.medium),
                    verticalArrangement = Arrangement.spacedBy(CeteleSpacing.medium),
                    content = content,
                )
            }
        }
    }
}

/** Customer balance on the ledger cover; [actions] sit on the cover under the figure. */
@Composable
fun BalanceBand(
    balance: Money,
    modifier: Modifier = Modifier,
    actions: (@Composable ColumnScope.() -> Unit)? = null,
) {
    LedgerCover(
        label = stringResource(R.string.designsystem_balance_label),
        amount = balance,
        modifier = modifier,
        tone = balanceTone(balance),
        content = actions,
    )
}

/** A thin rule on the cover, between the figure and what follows it. */
@Composable
fun CoverRule(modifier: Modifier = Modifier) {
    val color = CeteleTheme.cover.rule
    Canvas(modifier.fillMaxWidth().size(height = CeteleSpacing.hairline, width = 0.dp)) {
        drawLine(color, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = size.height)
    }
}

/** The brand tally (four notches crossed by the fifth) as a small, decorative cover detail. */
@Composable
fun TallyMark(
    ink: Color,
    cross: Color,
    modifier: Modifier = Modifier,
    width: Dp = TALLY_WIDTH,
    height: Dp = TALLY_HEIGHT,
) {
    Canvas(modifier.size(width, height).clearAndSetSemantics {}) {
        val stroke = size.height / TALLY_STROKE_RATIO
        val step = size.width / TALLY_STEPS
        repeat(TALLY_NOTCHES) { index ->
            val x = step * (index + 1)
            drawLine(ink, Offset(x, stroke), Offset(x, size.height - stroke), stroke, StrokeCap.Round)
        }
        drawLine(
            cross,
            Offset(stroke, size.height * TALLY_CROSS_LOW),
            Offset(size.width - stroke, size.height * TALLY_CROSS_HIGH),
            stroke,
            StrokeCap.Round,
        )
    }
}

private val TALLY_WIDTH = 30.dp
private val TALLY_HEIGHT = 20.dp
private const val TALLY_NOTCHES = 4
private const val TALLY_STEPS = 5f
private const val TALLY_STROKE_RATIO = 9f
private const val TALLY_CROSS_LOW = 0.78f
private const val TALLY_CROSS_HIGH = 0.22f
