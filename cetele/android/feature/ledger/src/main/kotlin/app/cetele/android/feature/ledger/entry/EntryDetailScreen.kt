package app.cetele.android.feature.ledger.entry

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.AmountStyle
import app.cetele.android.core.designsystem.component.AmountText
import app.cetele.android.core.designsystem.component.AmountTone
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.ConfirmSheet
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.feature.ledger.R
import app.cetele.android.feature.ledger.photo.EntryPhotoStatus
import app.cetele.android.core.designsystem.R as DesignR

@Composable
fun EntryDetailScreen(
    state: EntryDetailState,
    actions: EntryDetailActions,
    modifier: Modifier = Modifier,
    photoContent: @Composable (LedgerEntry) -> Unit = {
        Text(stringResource(R.string.ledger_photo_description))
    },
) {
    Scaffold(
        modifier = modifier,
        topBar = { CeteleTopBar(stringResource(R.string.ledger_detail_title), onBack = actions.onBack) },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
        ) {
            val entry = state.entry
            if (entry == null) {
                Text(
                    stringResource(
                        if (state.loading) R.string.ledger_detail_loading else R.string.ledger_detail_missing,
                    ),
                )
            } else {
                EntryDetails(entry, state, actions, photoContent)
            }
            EntryErrors(state.errors)
            if (state.failed) Text(stringResource(R.string.ledger_entry_write_error))
        }
    }
    if (state.confirmReversal && state.entry?.countsTowardBalance == true) {
        ConfirmSheet(
            title = stringResource(R.string.ledger_detail_confirm_title),
            text = stringResource(R.string.ledger_detail_confirm_text),
            confirmText = stringResource(DesignR.string.action_correct),
            destructive = true,
            onConfirm = actions.onConfirmReversal,
            onDismiss = actions.onDismissReversal,
            loading = state.busy,
        )
    }
}

@Composable
private fun EntryDetails(
    entry: LedgerEntry,
    state: EntryDetailState,
    actions: EntryDetailActions,
    photoContent: @Composable (LedgerEntry) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular)) {
        val typeLabel = if (entry.type == EntryType.DEBT) R.string.ledger_entry_debt else R.string.ledger_entry_payment
        Text(stringResource(typeLabel))
        AmountText(
            entry.amount,
            style = AmountStyle.Large,
            struck = entry.isReversed,
            tone = if (entry.type == EntryType.DEBT) AmountTone.Debt else AmountTone.Payment,
        )
        Text(DateFormats.long(entry.occurredOn))
        entry.dueOn?.let { Text(stringResource(R.string.ledger_detail_due, DateFormats.long(it))) }
        entry.note?.let { Text(it) }
        if (state.photoStatus != EntryPhotoStatus.Absent) photoContent(entry)
        if (state.photoStatus == EntryPhotoStatus.Uploading) Text(stringResource(R.string.ledger_photo_uploading))
        if (state.photoStatus == EntryPhotoStatus.Failed) {
            Text(stringResource(R.string.ledger_photo_failed))
            CeteleButton(
                stringResource(R.string.ledger_photo_send_without),
                actions.onSendWithoutPhoto,
                enabled = !state.busy,
            )
        }
        val relatedId = entry.reversedBy ?: entry.reverses
        if (relatedId != null) {
            val link =
                if (entry.isReversed) R.string.ledger_detail_reversal_link else R.string.ledger_detail_original_link
            CeteleButton(
                stringResource(link),
                { actions.onEntrySelected(relatedId) },
                style = ButtonStyle.Text,
            )
        } else {
            CeteleButton(
                stringResource(DesignR.string.action_correct),
                actions.onRequestReversal,
                enabled = !state.busy,
            )
        }
    }
}
