package app.cetele.android.core.designsystem.component

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
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
) {
    val colors = CeteleTheme.colors
    Text(
        text = MoneyFormat.format(money.minor),
        modifier = modifier,
        style = if (style == AmountStyle.Large) CeteleTextStyles.amountLarge else CeteleTextStyles.amount,
        color =
            when (tone) {
                AmountTone.Neutral -> colors.textMuted
                AmountTone.Debt -> colors.debtText
                AmountTone.Payment -> colors.paymentText
            },
        textDecoration = if (struck) TextDecoration.LineThrough else TextDecoration.None,
    )
}

internal fun balanceTone(balance: Money): AmountTone =
    when {
        balance.minor > 0 -> AmountTone.Debt
        balance.minor < 0 -> AmountTone.Payment
        else -> AmountTone.Neutral
    }
