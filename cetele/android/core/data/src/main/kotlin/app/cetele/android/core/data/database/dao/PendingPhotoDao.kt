package app.cetele.android.core.data.database.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import app.cetele.android.core.data.database.entity.PendingPhotoEntity

@Dao
interface PendingPhotoDao {
    @Upsert suspend fun upsert(row: PendingPhotoEntity)

    @Query(
        """
            SELECT * FROM pending_photos WHERE shop_id = :shopId AND state IN ('QUEUED', 'UPLOADED')
            ORDER BY created_at, entry_id
        """,
    )
    suspend fun pending(shopId: String): List<PendingPhotoEntity>

    @Query("SELECT * FROM pending_photos WHERE shop_id = :shopId AND entry_id = :entryId")
    suspend fun get(
        shopId: String,
        entryId: String,
    ): PendingPhotoEntity?

    @Query("SELECT * FROM pending_photos WHERE shop_id = :shopId")
    suspend fun all(shopId: String): List<PendingPhotoEntity>

    @Query("DELETE FROM pending_photos WHERE shop_id = :shopId AND entry_id = :entryId")
    suspend fun delete(
        shopId: String,
        entryId: String,
    )

    @Query("DELETE FROM pending_photos WHERE shop_id = :shopId")
    suspend fun deleteShop(shopId: String)
}
