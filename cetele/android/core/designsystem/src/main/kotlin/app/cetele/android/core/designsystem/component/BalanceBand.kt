package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.domain.model.Money

@Composable
fun BalanceBand(
    balance: Money,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier.fillMaxWidth(), color = CeteleTheme.colors.surfaceSunken) {
        Column(
            modifier = Modifier.padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.small),
        ) {
            Text(stringResource(R.string.designsystem_balance_label), style = CeteleTextStyles.body)
            AmountText(balance, style = AmountStyle.Large, tone = balanceTone(balance))
        }
    }
}
