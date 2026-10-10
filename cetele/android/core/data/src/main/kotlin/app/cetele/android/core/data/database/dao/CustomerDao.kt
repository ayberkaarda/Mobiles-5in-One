package app.cetele.android.core.data.database.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import app.cetele.android.core.data.database.entity.CustomerEntity
import kotlinx.coroutines.flow.Flow

data class CustomerBalance(
    val customerId: String,
    val balanceMinor: Long,
)

@Dao
interface CustomerDao {
    @Query(
        """
            SELECT * FROM customers WHERE shop_id = :shopId AND deleted_at IS NULL AND (search_key
            LIKE :queryKey || '%' ESCAPE '\' OR phone LIKE :queryKey || '%' ESCAPE '\') ORDER BY
            search_key, id
        """,
    )
    fun observeLive(
        shopId: String,
        queryKey: String,
    ): Flow<List<CustomerEntity>>

    @Query("SELECT * FROM customers WHERE shop_id = :shopId")
    fun observeAll(shopId: String): Flow<List<CustomerEntity>>

    @Query("SELECT * FROM customers WHERE shop_id = :shopId AND id = :id")
    suspend fun get(
        shopId: String,
        id: String,
    ): CustomerEntity?

    @Query("SELECT * FROM customers WHERE shop_id = :shopId AND id = :id")
    fun observe(
        shopId: String,
        id: String,
    ): Flow<CustomerEntity?>

    @Upsert suspend fun upsert(row: CustomerEntity)

    @Query(
        """
            UPDATE customers SET deleted_at = :at, updated_at = :at, sync_state = 'PENDING' WHERE
            shop_id = :shopId AND id = :id
        """,
    )
    suspend fun markDeleted(
        shopId: String,
        id: String,
        at: String,
    )

    @Query("SELECT COUNT(*) FROM customers WHERE shop_id = :shopId AND deleted_at IS NULL")
    suspend fun countLive(shopId: String): Int

    @Query(
        """
            SELECT c.id AS customerId, COALESCE(SUM(CASE WHEN e.reverses IS NULL AND e.reversed_by IS
            NULL THEN CASE WHEN e.type = 'DEBT' THEN e.amount_minor ELSE -e.amount_minor END ELSE 0
            END), 0) AS balanceMinor FROM customers c LEFT JOIN ledger_entries e ON e.shop_id =
            c.shop_id AND e.customer_id = c.id WHERE c.shop_id = :shopId AND c.deleted_at IS NULL
            GROUP BY c.id
        """,
    )
    fun observeBalances(shopId: String): Flow<List<CustomerBalance>>

    @Query("DELETE FROM customers WHERE shop_id = :shopId AND id = :id")
    suspend fun delete(
        shopId: String,
        id: String,
    )

    @Query("DELETE FROM customers WHERE shop_id = :shopId")
    suspend fun deleteShop(shopId: String)
}
