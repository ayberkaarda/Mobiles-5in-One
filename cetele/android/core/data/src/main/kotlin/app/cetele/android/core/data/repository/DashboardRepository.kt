package app.cetele.android.core.data.repository

import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.domain.ledger.DashboardSummary
import app.cetele.android.core.domain.ledger.DebtorLine
import app.cetele.android.core.domain.ledger.DueLine
import app.cetele.android.core.domain.model.Money
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import java.time.LocalDate
import javax.inject.Inject

interface DashboardRepository {
    fun observe(
        shopId: String,
        today: LocalDate,
    ): Flow<DashboardSummary>
}

class RoomDashboardRepository
    @Inject
    constructor(
        private val databases: DatabaseStore,
    ) : DashboardRepository {
        override fun observe(
            shopId: String,
            today: LocalDate,
        ): Flow<DashboardSummary> {
            val db = databases.get()
            val dao = db.dashboardDao()
            val totals =
                combine(
                    dao.todayTotals(shopId, today.toString()),
                    dao.totalReceivable(shopId),
                    dao.topDebtors(shopId),
                ) { daily, total, debtors ->
                    DashboardSummary(
                        Money(daily.debtMinor),
                        Money(daily.paymentMinor),
                        Money(total),
                        debtors.map { DebtorLine(it.customerId, it.name, Money(it.balanceMinor)) },
                        emptyList(),
                    )
                }
            val due =
                combine(
                    dao.dueToday(shopId, today.toString()),
                    db.customerDao().observeLive(shopId, ""),
                    db.customerDao().observeBalances(shopId),
                ) { entries, customers, balances ->
                    val names = customers.associate { it.id to it.name }
                    val amounts =
                        balances.associate {
                            it.customerId to
                                it.balanceMinor
                        }
                    entries.map {
                        DueLine(
                            it.asModel(),
                            names[it.customerId].orEmpty(),
                            Money(amounts[it.customerId] ?: 0),
                        )
                    }
                }
            return combine(totals, due) { summary, lines -> summary.copy(dueToday = lines) }
        }
    }
