package app.cetele.android.core.domain.ledger

import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.domain.model.Money

data class StatementRow(
    val entry: LedgerEntry,
    val runningBalance: Money,
    val struck: Boolean,
    val correctionOf: String?,
)

object StatementRows {
    fun build(entries: List<LedgerEntry>): List<StatementRow> {
        var balance = Money.ZERO
        return entries.sortedWith(compareBy({ it.occurredOn }, { it.createdAt }, { it.id })).map { entry ->
            if (entry.countsTowardBalance) {
                balance = if (entry.type == EntryType.DEBT) balance + entry.amount else balance - entry.amount
            }
            StatementRow(entry, balance, entry.isReversed, entry.reverses)
        }
    }
}
