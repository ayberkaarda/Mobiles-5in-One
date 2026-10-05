package app.cetele.android.core.data.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/** Last server change-log sequence pulled for a shop (monotonic per shop, BIGINT on the server). */
@Entity(tableName = "sync_cursor")
data class SyncCursorEntity(
    @PrimaryKey
    @ColumnInfo(name = "shop_id")
    val shopId: String,
    @ColumnInfo(name = "last_pulled_seq")
    val lastPulledSeq: Long,
)
