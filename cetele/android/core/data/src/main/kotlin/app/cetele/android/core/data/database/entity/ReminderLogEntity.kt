package app.cetele.android.core.data.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "reminder_log", indices = [Index(value = ["shop_id", "customer_id", "sent_at"], unique = false)])
data class ReminderLogEntity(
    @PrimaryKey
    @ColumnInfo(name = "id") val id: String,
    @ColumnInfo(name = "shop_id") val shopId: String,
    @ColumnInfo(name = "customer_id") val customerId: String,
    @ColumnInfo(name = "channel") val channel: String,
    @ColumnInfo(name = "sent_at") val sentAt: String,
    @ColumnInfo(name = "status") val status: String,
    @ColumnInfo(name = "quota_used") val quotaUsed: Int? = null,
    @ColumnInfo(name = "quota_limit") val quotaLimit: Int? = null,
)
