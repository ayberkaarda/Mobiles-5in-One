package app.cetele.android.core.domain.ledger

import app.cetele.android.core.domain.model.EntryType

data class BalanceLine(
    val type: EntryType,
    val amountMinor: Long,
    val reverses: String? = null,
    val reversedBy: String? = null,
)
