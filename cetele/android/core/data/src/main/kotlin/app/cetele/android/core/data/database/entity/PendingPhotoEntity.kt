package app.cetele.android.core.data.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "pending_photos", indices = [Index(value = ["shop_id", "state"], unique = false)])
data class PendingPhotoEntity(
    @PrimaryKey
    @ColumnInfo(name = "entry_id") val entryId: String,
    @ColumnInfo(name = "shop_id") val shopId: String,
    @ColumnInfo(name = "local_path") val localPath: String,
    @ColumnInfo(name = "content_length") val contentLength: Int,
    @ColumnInfo(name = "media_id") val mediaId: String? = null,
    @ColumnInfo(name = "photo_key") val photoKey: String? = null,
    @ColumnInfo(name = "state") val state: String,
    @ColumnInfo(name = "attempts") val attempts: Int = 0,
    @ColumnInfo(name = "last_code") val lastCode: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
)
