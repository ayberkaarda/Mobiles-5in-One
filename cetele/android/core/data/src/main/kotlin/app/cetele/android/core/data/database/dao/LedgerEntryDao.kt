package app.cetele.android.core.data.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import kotlinx.coroutines.flow.Flow

// A DAO is the catalogue of its table's queries; splitting it would only scatter them.
@Suppress("TooManyFunctions")
@Dao
interface LedgerEntryDao {
    @Query(
        """
            SELECT * FROM ledger_entries WHERE shop_id = :shopId AND customer_id = :customerId ORDER
            BY occurred_on, created_at, id
        """,
    )
    fun observeForCustomer(
        shopId: String,
        customerId: String,
    ): Flow<List<LedgerEntryEntity>>

    @Query("SELECT * FROM ledger_entries WHERE shop_id = :shopId AND id = :id")
    suspend fun get(
        shopId: String,
        id: String,
    ): LedgerEntryEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(row: LedgerEntryEntity)

    @Upsert suspend fun upsert(row: LedgerEntryEntity)

    @Query("DELETE FROM ledger_entries WHERE shop_id = :shopId AND id = :id")
    suspend fun delete(
        shopId: String,
        id: String,
    )

    @Query("UPDATE ledger_entries SET reversed_by = :reversedBy WHERE shop_id = :shopId AND id = :id")
    suspend fun setReversedBy(
        shopId: String,
        id: String,
        reversedBy: String?,
    )

    @Query("UPDATE ledger_entries SET photo_key = :photoKey WHERE shop_id = :shopId AND id = :id")
    suspend fun setPhotoKey(
        shopId: String,
        id: String,
        photoKey: String?,
    )

    @Query("SELECT * FROM ledger_entries WHERE shop_id = :shopId AND customer_id = :customerId")
    suspend fun balanceLines(
        shopId: String,
        customerId: String,
    ): List<LedgerEntryEntity>

    @Query("SELECT * FROM ledger_entries WHERE shop_id = :shopId ORDER BY occurred_on, created_at, id")
    fun observeAllForExport(shopId: String): Flow<List<LedgerEntryEntity>>

    @Query("SELECT * FROM ledger_entries WHERE shop_id = :shopId")
    suspend fun all(shopId: String): List<LedgerEntryEntity>

    @Query("DELETE FROM ledger_entries WHERE shop_id = :shopId")
    suspend fun deleteShop(shopId: String)
}
