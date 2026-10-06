package app.cetele.android.core.data.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "shops")
data class ShopEntity(
    @PrimaryKey
    @ColumnInfo(name = "id") val id: String,
    @ColumnInfo(name = "name") val name: String,
    @ColumnInfo(name = "type") val type: String,
    @ColumnInfo(name = "il") val il: String,
    @ColumnInfo(name = "ilce") val ilce: String,
    @ColumnInfo(name = "plan") val plan: String,
    @ColumnInfo(name = "role") val role: String,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "refreshed_at") val refreshedAt: String,
)
