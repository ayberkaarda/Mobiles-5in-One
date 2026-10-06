package app.cetele.android.core.data.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "outbox_operations",
    indices = [
        Index(
            value = ["shop_id", "client_seq"],
            unique = true,
        ), Index(value = ["shop_id", "state", "created_at"], unique = false),
    ],
)
data class OutboxEntity(
    @PrimaryKey
    @ColumnInfo(name = "client_id") val clientId: String,
    @ColumnInfo(name = "shop_id") val shopId: String,
    @ColumnInfo(name = "kind") val kind: String,
    @ColumnInfo(name = "entity_id") val entityId: String,
    @ColumnInfo(name = "payload_json") val payloadJson: String,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "client_seq") val clientSeq: Long? = null,
    @ColumnInfo(name = "depends_on_client_id") val dependsOnClientId: String? = null,
    @ColumnInfo(name = "photo_entry_id") val photoEntryId: String? = null,
    @ColumnInfo(name = "state") val state: String,
    @ColumnInfo(name = "attempts") val attempts: Int = 0,
    @ColumnInfo(name = "last_code") val lastCode: String? = null,
    @ColumnInfo(name = "errors_json") val errorsJson: String? = null,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
)
