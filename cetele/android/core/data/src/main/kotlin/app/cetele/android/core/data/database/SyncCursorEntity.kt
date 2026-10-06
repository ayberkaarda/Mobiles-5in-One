package app.cetele.android.core.data.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sync_cursor")
data class SyncCursorEntity(
    @PrimaryKey @ColumnInfo(name = "shop_id") val shopId: String,
    @ColumnInfo(name = "last_pulled_seq") val lastPulledSeq: Long = 0,
    @ColumnInfo(name = "next_client_seq", defaultValue = "1") val nextClientSeq: Long = 1,
    @ColumnInfo(name = "last_push_at") val lastPushAt: String? = null,
    @ColumnInfo(name = "last_pull_at") val lastPullAt: String? = null,
    @ColumnInfo(name = "last_error_code") val lastErrorCode: String? = null,
)
