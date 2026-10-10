package app.cetele.android.core.data.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "ledger_entries",
    indices = [
        Index(
            value = ["shop_id", "customer_id", "occurred_on", "created_at"],
            unique = false,
        ), Index(
            value = ["shop_id", "occurred_on"],
            unique = false,
        ), Index(value = ["shop_id", "due_on"], unique = false),
    ],
)
data class LedgerEntryEntity(
    @PrimaryKey
    @ColumnInfo(name = "id") val id: String,
    @ColumnInfo(name = "shop_id") val shopId: String,
    @ColumnInfo(name = "customer_id") val customerId: String,
    @ColumnInfo(name = "type") val type: String,
    @ColumnInfo(name = "amount_minor") val amountMinor: Long,
    @ColumnInfo(name = "currency") val currency: String = "TRY",
    @ColumnInfo(name = "occurred_on") val occurredOn: String,
    @ColumnInfo(name = "due_on") val dueOn: String? = null,
    @ColumnInfo(name = "note") val note: String? = null,
    @ColumnInfo(name = "photo_key") val photoKey: String? = null,
    @ColumnInfo(name = "reverses") val reverses: String? = null,
    @ColumnInfo(name = "reversed_by") val reversedBy: String? = null,
    @ColumnInfo(name = "created_by") val createdBy: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "sync_state") val syncState: String = "PENDING",
)
