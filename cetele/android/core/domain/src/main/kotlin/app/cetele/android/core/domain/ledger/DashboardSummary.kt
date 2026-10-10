package app.cetele.android.core.domain.ledger

import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.domain.model.Money
import java.time.LocalDate

data class DebtorLine(
    val customerId: String,
    val name: String,
    val balance: Money,
)

data class DueLine(
    val entry: LedgerEntry,
    val customerName: String,
    val balance: Money,
)

data class DashboardSummary(
    val todayDebt: Money,
    val todayPayment: Money,
    val totalReceivable: Money,
    val topDebtors: List<DebtorLine>,
    val dueToday: List<DueLine>,
) {
    companion object {
        private const val TOP_LIMIT = 10

        fun compute(
            customers: List<Customer>,
            entries: List<LedgerEntry>,
            today: LocalDate,
        ): DashboardSummary {
            val live = customers.filter { it.deletedAt == null }.associateBy { it.shopId to it.id }
            val active = entries.filter { it.countsTowardBalance && (it.shopId to it.customerId) in live }
            val balances =
                active.groupBy { it.shopId to it.customerId }.mapValues { (_, rows) ->
                    Balance.of(rows.map { BalanceLine(it.type, it.amount.minor) })
                }
            val debtors =
                live
                    .map { (key, customer) ->
                        DebtorLine(customer.id, customer.name, balances[key] ?: Money.ZERO)
                    }.filter { it.balance.isPositive }
            val due =
                active
                    .filter { it.type == EntryType.DEBT && it.dueOn == today }
                    .map { entry ->
                        val key = entry.shopId to entry.customerId
                        DueLine(entry, live.getValue(key).name, balances.getValue(key))
                    }.filter { it.balance.isPositive }
                    .sortedWith(compareBy({ it.entry.occurredOn }, { it.entry.createdAt }, { it.entry.id }))
            val todayRows = active.filter { it.occurredOn == today }
            return DashboardSummary(
                todayDebt = Money.sum(todayRows.filter { it.type == EntryType.DEBT }.map { it.amount }),
                todayPayment = Money.sum(todayRows.filter { it.type == EntryType.PAYMENT }.map { it.amount }),
                totalReceivable = Money.sum(debtors.map { it.balance }),
                topDebtors =
                    debtors
                        .sortedWith(
                            compareByDescending<DebtorLine> { it.balance }.thenBy { it.name }.thenBy { it.customerId },
                        ).take(TOP_LIMIT),
                dueToday = due,
            )
        }
    }
}
