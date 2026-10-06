package app.cetele.android.core.domain.ledger

import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.Money

object Balance {
    fun of(lines: Iterable<BalanceLine>): Money =
        lines.fold(Money.ZERO) { balance, line ->
            when {
                line.reverses != null || line.reversedBy != null -> balance
                line.type == EntryType.DEBT -> balance + Money(line.amountMinor)
                else -> balance - Money(line.amountMinor)
            }
        }
}
