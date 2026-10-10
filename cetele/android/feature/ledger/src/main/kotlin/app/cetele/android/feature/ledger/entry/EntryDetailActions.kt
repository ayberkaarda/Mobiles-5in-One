package app.cetele.android.feature.ledger.entry

data class EntryDetailActions(
    val onBack: () -> Unit,
    val onEntrySelected: (String) -> Unit,
    val onRequestReversal: () -> Unit,
    val onConfirmReversal: () -> Unit,
    val onDismissReversal: () -> Unit,
    val onSendWithoutPhoto: () -> Unit = {},
)
