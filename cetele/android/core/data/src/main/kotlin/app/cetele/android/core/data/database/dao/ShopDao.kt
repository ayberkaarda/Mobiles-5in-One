package app.cetele.android.core.data.database.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import app.cetele.android.core.data.database.entity.ShopEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ShopDao {
    @Query("SELECT * FROM shops ORDER BY created_at, id")
    fun observeAll(): Flow<List<ShopEntity>>

    @Query("SELECT * FROM shops ORDER BY id")
    suspend fun all(): List<ShopEntity>

    @Query("SELECT * FROM shops WHERE id = :shopId")
    suspend fun get(shopId: String): ShopEntity?

    @Upsert suspend fun upsertAll(rows: List<ShopEntity>)

    @Query("DELETE FROM shops WHERE id NOT IN (:ids)")
    suspend fun deleteNotIn(ids: List<String>)

    @Query("DELETE FROM shops WHERE id = :shopId")
    suspend fun delete(shopId: String)
}
