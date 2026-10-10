package app.cetele.android.feature.ledger.entry

import app.cetele.android.core.domain.model.EntryType
import java.time.LocalDate

data class EntryEditActions(
    val onAmount: (Long) -> Unit,
    val onType: (EntryType) -> Unit,
    val onOccurredOn: (LocalDate) -> Unit,
    val onDueOn: (LocalDate?) -> Unit,
    val onNote: (String) -> Unit,
    val onCapture: () -> Unit,
    val onRemovePhoto: () -> Unit,
    val onSave: () -> Unit,
    val onBack: () -> Unit,
)
