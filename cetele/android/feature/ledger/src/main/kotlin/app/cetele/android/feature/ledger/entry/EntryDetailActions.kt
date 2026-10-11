package app.cetele.android.feature.ledger.entry

data class EntryDetailActions(
    val onBack: () -> Unit,
    val onEntrySelected: (String) -> Unit,
    val onRequestReversal: () -> Unit,
    val onConfirmReversal: () -> Unit,
    val onDismissReversal: () -> Unit,
    val onSendWithoutPhoto: () -> Unit = {},
    /** Opens the Çetele Pro screen after `plan.photo_limit` (owner only); `null` hides the button. */
    val onUpgrade: (() -> Unit)? = null,
)
