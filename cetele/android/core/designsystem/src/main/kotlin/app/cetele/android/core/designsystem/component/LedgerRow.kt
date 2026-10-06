package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextDecoration
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry

@Composable
fun LedgerRow(
    entry: LedgerEntry,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    customerName: String? = null,
    struck: Boolean = entry.isReversed,
) {
    val debt = entry.type == EntryType.DEBT
    val kind = stringResource(if (debt) R.string.designsystem_ledger_debt else R.string.designsystem_ledger_payment)
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = CeteleSpacing.rowMinHeight)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(CeteleSpacing.screenGutter),
        horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.medium),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painterResource(if (debt) CeteleIcons.debt else CeteleIcons.payment),
            contentDescription = null,
            tint = if (debt) CeteleTheme.colors.debtMark else CeteleTheme.colors.paymentMark,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = customerName ?: kind,
                style = CeteleTextStyles.bodyStrong,
                textDecoration = if (struck) TextDecoration.LineThrough else TextDecoration.None,
            )
            if (customerName != null) Text(kind, style = CeteleTextStyles.caption)
            Text(DateFormats.short(entry.occurredOn), style = CeteleTextStyles.caption)
            entry.note?.let { Text(it, style = CeteleTextStyles.body) }
            if (entry.isReversal) Text(stringResource(R.string.designsystem_ledger_correction))
            if (struck) Text(stringResource(R.string.designsystem_ledger_reversed), style = CeteleTextStyles.caption)
        }
        AmountText(entry.amount, tone = if (debt) AmountTone.Debt else AmountTone.Payment, struck = struck)
    }
}
