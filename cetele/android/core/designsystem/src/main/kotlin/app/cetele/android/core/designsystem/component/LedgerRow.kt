package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry

/**
 * One ledger entry. The notch on the left says what it is (debt, payment, a struck entry, or the diagonal
 * notch of a correction); the line reads "what" first (the note), then the kind and date.
 */
@Composable
fun LedgerRow(
    entry: LedgerEntry,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    customerName: String? = null,
    struck: Boolean = entry.isReversed,
) {
    val kind = entryKind(entry)
    val correction = stringResource(R.string.designsystem_ledger_correction)
    val title = customerName ?: entry.note ?: if (entry.isReversal) correction else kind
    val notch = notchOf(entry, struck)
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = CeteleSpacing.rowMinHeight)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(horizontal = CeteleSpacing.regular, vertical = CeteleSpacing.medium),
        horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.medium),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        EntryNotch(notch)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(CeteleSpacing.extraSmall)) {
            EntryTitle(title, struck)
            if (customerName != null && entry.note != null) {
                Text(entry.note.orEmpty(), style = CeteleTextStyles.body, color = CeteleTheme.colors.text)
            }
            EntryMeta(
                kind = kind.takeIf { it != title },
                date = DateFormats.short(entry.occurredOn),
                correction = correction.takeIf { entry.isReversal && it != title },
                struck = struck,
            )
        }
        AmountText(entry.amount, tone = toneOf(notch), struck = struck)
    }
}

@Composable
private fun entryKind(entry: LedgerEntry): String =
    stringResource(
        if (entry.type == EntryType.DEBT) R.string.designsystem_ledger_debt else R.string.designsystem_ledger_payment,
    )

private fun notchOf(
    entry: LedgerEntry,
    struck: Boolean,
): NotchKind =
    when {
        struck -> NotchKind.Reversed
        entry.isReversal -> NotchKind.Correction
        entry.type == EntryType.DEBT -> NotchKind.Debt
        else -> NotchKind.Payment
    }

private fun toneOf(notch: NotchKind): AmountTone =
    when (notch) {
        NotchKind.Debt -> AmountTone.Debt
        NotchKind.Payment -> AmountTone.Payment
        NotchKind.Reversed, NotchKind.Correction -> AmountTone.Neutral
    }

@Composable
private fun EntryTitle(
    title: String,
    struck: Boolean,
) {
    Text(
        text = title,
        style = CeteleTextStyles.bodyStrong,
        color = if (struck) CeteleTheme.colors.textMuted else CeteleTheme.colors.text,
        textDecoration = if (struck) TextDecoration.LineThrough else TextDecoration.None,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Kind and date in muted caption, then the correction tags. */
@Composable
private fun EntryMeta(
    kind: String?,
    date: String,
    correction: String?,
    struck: Boolean,
) {
    val muted = CeteleTheme.colors.textMuted
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small),
        verticalArrangement = Arrangement.spacedBy(CeteleSpacing.extraSmall),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        if (kind != null) Text(kind, style = CeteleTextStyles.caption, color = muted)
        Text(date, style = CeteleTextStyles.caption, color = muted)
        if (correction != null) Tag(correction, color = CeteleTheme.colors.accentText)
        if (struck) Tag(stringResource(R.string.designsystem_ledger_reversed))
    }
}
