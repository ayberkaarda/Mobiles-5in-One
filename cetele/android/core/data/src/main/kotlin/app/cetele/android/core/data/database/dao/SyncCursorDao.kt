package app.cetele.android.core.data.database.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import app.cetele.android.core.data.database.SyncCursorEntity

@Dao
abstract class SyncCursorDao {
    @Query("SELECT * FROM sync_cursor WHERE shop_id = :shopId")
    abstract suspend fun get(shopId: String): SyncCursorEntity?

    @Upsert abstract suspend fun upsert(row: SyncCursorEntity)

    @Query("DELETE FROM sync_cursor WHERE shop_id = :shopId")
    abstract suspend fun deleteShop(shopId: String)

    @Transaction
    open suspend fun allocateClientSeqs(
        shopId: String,
        count: Int,
    ): LongRange {
        require(count >= 0)
        val cursor = get(shopId) ?: SyncCursorEntity(shopId)
        val end = Math.addExact(cursor.nextClientSeq, count.toLong())
        upsert(cursor.copy(nextClientSeq = end))
        return cursor.nextClientSeq until end
    }
}
