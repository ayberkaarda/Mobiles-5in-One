package app.cetele.android.core.data.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import app.cetele.android.core.data.database.entity.ReminderLogEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ReminderLogDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(row: ReminderLogEntity)

    @Query(
        """
            SELECT * FROM reminder_log WHERE shop_id = :shopId AND customer_id = :customerId ORDER BY
            sent_at DESC, id DESC LIMIT 1
        """,
    )
    fun observeLast(
        shopId: String,
        customerId: String,
    ): Flow<ReminderLogEntity?>

    @Query("DELETE FROM reminder_log WHERE shop_id = :shopId")
    suspend fun deleteShop(shopId: String)
}
