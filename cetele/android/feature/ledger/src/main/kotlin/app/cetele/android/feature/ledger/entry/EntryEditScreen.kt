package app.cetele.android.feature.ledger.entry

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.AmountKeypad
import app.cetele.android.core.designsystem.component.AmountStyle
import app.cetele.android.core.designsystem.component.AmountText
import app.cetele.android.core.designsystem.component.AmountTone
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTextField
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.Money
import app.cetele.android.feature.ledger.R
import app.cetele.android.feature.ledger.photo.EntryPhotoDraft
import java.time.LocalDate
import app.cetele.android.core.designsystem.R as DesignR

@Composable
fun EntryEditScreen(
    state: EntryEditState,
    actions: EntryEditActions,
    modifier: Modifier = Modifier,
) {
    var picker by rememberSaveable { mutableStateOf<String?>(null) }
    val enabled = !state.busy && !state.photoBusy && state.savedId == null
    Scaffold(
        modifier = modifier,
        topBar = { CeteleTopBar(stringResource(R.string.ledger_entry_title), onBack = actions.onBack) },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
        ) {
            EntryTypePicker(state.type, actions.onType, enabled)
            AmountText(
                Money(state.amountMinor),
                style = AmountStyle.Large,
                tone = if (state.type == EntryType.DEBT) AmountTone.Debt else AmountTone.Payment,
            )
            AmountKeypad(state.amountMinor, actions.onAmount, enabled = enabled)
            EntryErrors(state.errors)
            EntryDates(state, { picker = it }, { actions.onDueOn(null) }, enabled)
            CeteleTextField(
                state.note,
                actions.onNote,
                stringResource(R.string.ledger_entry_note),
                modifier = Modifier.fillMaxWidth(),
                enabled = enabled,
                singleLine = false,
            )
            EntryPhotoDraft(state, actions.onCapture, actions.onRemovePhoto)
            if (state.writeFailed) Text(stringResource(R.string.ledger_entry_write_error))
            CeteleButton(
                stringResource(DesignR.string.action_save),
                actions.onSave,
                modifier = Modifier.fillMaxWidth(),
                enabled = enabled && state.shopId != null,
                loading = state.busy,
            )
        }
    }
    picker?.let { field ->
        EntryDatePicker(
            selected = if (field == "due") state.dueOn ?: state.today else state.occurredOn,
            maxDate = if (field == "occurred") state.today.plusDays(1) else null,
            onSelect = {
                if (field == "due") actions.onDueOn(it) else actions.onOccurredOn(it)
                picker = null
            },
            onDismiss = { picker = null },
        )
    }
}

@Composable
private fun EntryDates(
    state: EntryEditState,
    onPick: (String) -> Unit,
    onClearDue: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(CeteleSpacing.small)) {
        CeteleButton(
            stringResource(R.string.ledger_entry_date, DateFormats.long(state.occurredOn)),
            { onPick("occurred") },
            style = ButtonStyle.Outlined,
            enabled = enabled,
        )
        if (state.type == EntryType.DEBT) {
            CeteleButton(
                stringResource(R.string.ledger_entry_due),
                { onPick("due") },
                style = ButtonStyle.Outlined,
                enabled = enabled,
            )
            state.dueOn?.let { due ->
                Text(DateFormats.long(due))
                CeteleButton(
                    stringResource(R.string.ledger_entry_clear_due),
                    onClearDue,
                    style = ButtonStyle.Text,
                    enabled = enabled,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EntryTypePicker(
    type: EntryType,
    onType: (EntryType) -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    SingleChoiceSegmentedButtonRow(modifier = modifier.fillMaxWidth()) {
        EntryType.entries.forEachIndexed { index, entryType ->
            SegmentedButton(
                selected = type == entryType,
                onClick = { onType(entryType) },
                enabled = enabled,
                shape = SegmentedButtonDefaults.itemShape(index, EntryType.entries.size),
            ) {
                Text(
                    stringResource(
                        if (entryType ==
                            EntryType.DEBT
                        ) {
                            R.string.ledger_entry_debt
                        } else {
                            R.string.ledger_entry_payment
                        },
                    ),
                )
            }
        }
    }
}
