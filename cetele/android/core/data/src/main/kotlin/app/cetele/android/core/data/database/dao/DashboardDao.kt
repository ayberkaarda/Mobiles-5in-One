package app.cetele.android.core.data.database.dao

import androidx.room.Dao
import androidx.room.Query
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import kotlinx.coroutines.flow.Flow

data class TodayTotals(
    val debtMinor: Long,
    val paymentMinor: Long,
)

data class DebtorTotal(
    val customerId: String,
    val name: String,
    val balanceMinor: Long,
)

@Dao
interface DashboardDao {
    @Query(
        """
            SELECT COALESCE(SUM(CASE WHEN e.type = 'DEBT' THEN e.amount_minor ELSE 0 END), 0) AS
            debtMinor, COALESCE(SUM(CASE WHEN e.type = 'PAYMENT' THEN e.amount_minor ELSE 0 END), 0)
            AS paymentMinor FROM ledger_entries e JOIN customers c ON c.id = e.customer_id AND
            c.shop_id = e.shop_id WHERE e.shop_id = :shopId AND c.deleted_at IS NULL AND e.occurred_on
            = :today AND e.reverses IS NULL AND e.reversed_by IS NULL
        """,
    )
    fun todayTotals(
        shopId: String,
        today: String,
    ): Flow<TodayTotals>

    @Query(
        """
            SELECT c.id AS customerId, c.name AS name, SUM(CASE WHEN e.type = 'DEBT' THEN
            e.amount_minor ELSE -e.amount_minor END) AS balanceMinor FROM customers c JOIN
            ledger_entries e ON e.customer_id = c.id AND e.shop_id = c.shop_id WHERE c.shop_id =
            :shopId AND c.deleted_at IS NULL AND e.reverses IS NULL AND e.reversed_by IS NULL GROUP BY
            c.id HAVING balanceMinor > 0 ORDER BY balanceMinor DESC, c.name, c.id LIMIT :limit
        """,
    )
    fun topDebtors(
        shopId: String,
        limit: Int = 10,
    ): Flow<List<DebtorTotal>>

    @Query(
        """
            SELECT e.* FROM ledger_entries e JOIN customers c ON c.id = e.customer_id AND c.shop_id =
            e.shop_id WHERE e.shop_id = :shopId AND c.deleted_at IS NULL AND e.type = 'DEBT' AND
            e.due_on = :today AND e.reverses IS NULL AND e.reversed_by IS NULL AND (SELECT
            COALESCE(SUM(CASE WHEN b.type = 'DEBT' THEN b.amount_minor ELSE -b.amount_minor END), 0)
            FROM ledger_entries b WHERE b.shop_id = :shopId AND b.customer_id = c.id AND b.reverses IS
            NULL AND b.reversed_by IS NULL) > 0 ORDER BY e.occurred_on, e.created_at, e.id
        """,
    )
    fun dueToday(
        shopId: String,
        today: String,
    ): Flow<List<LedgerEntryEntity>>

    @Query(
        """
            SELECT COALESCE(SUM(balanceMinor), 0) FROM (SELECT SUM(CASE WHEN e.type = 'DEBT' THEN
            e.amount_minor ELSE -e.amount_minor END) AS balanceMinor FROM customers c JOIN
            ledger_entries e ON e.customer_id = c.id AND e.shop_id = c.shop_id WHERE c.shop_id =
            :shopId AND c.deleted_at IS NULL AND e.reverses IS NULL AND e.reversed_by IS NULL GROUP BY
            c.id HAVING balanceMinor > 0)
        """,
    )
    fun totalReceivable(shopId: String): Flow<Long>
}
