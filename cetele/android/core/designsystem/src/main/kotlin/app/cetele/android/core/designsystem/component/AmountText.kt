package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.domain.format.MoneyFormat
import app.cetele.android.core.domain.model.Money

enum class AmountStyle {
    Row,
    Large,
}

enum class AmountTone {
    Neutral,
    Debt,
    Payment,
}

@Composable
fun AmountText(
    money: Money,
    modifier: Modifier = Modifier,
    style: AmountStyle = AmountStyle.Row,
    tone: AmountTone = AmountTone.Neutral,
    struck: Boolean = false,
    color: Color = Color.Unspecified,
) {
    val colors = CeteleTheme.colors
    val large = style == AmountStyle.Large
    Text(
        text = MoneyFormat.format(money.minor),
        modifier = modifier,
        style = if (large) CeteleTextStyles.amountLarge else CeteleTextStyles.amount,
        maxLines = 1,
        softWrap = false,
        overflow = TextOverflow.Visible,
        autoSize =
            if (large) {
                TextAutoSize.StepBased(CeteleTextStyles.amountLargeMinSize, CeteleTextStyles.amountLarge.fontSize)
            } else {
                TextAutoSize.StepBased(CeteleTextStyles.body.fontSize, CeteleTextStyles.amount.fontSize)
            },
        color =
            color.takeOrElse {
                when (tone) {
                    AmountTone.Neutral -> colors.textMuted
                    AmountTone.Debt -> colors.debtText
                    AmountTone.Payment -> colors.paymentText
                }
            },
        textDecoration = if (struck) TextDecoration.LineThrough else TextDecoration.None,
    )
}

fun balanceTone(balance: Money): AmountTone =
    when {
        balance.minor > 0 -> AmountTone.Debt
        balance.minor < 0 -> AmountTone.Payment
        else -> AmountTone.Neutral
    }
