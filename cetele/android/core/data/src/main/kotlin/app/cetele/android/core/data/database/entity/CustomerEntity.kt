package app.cetele.android.core.data.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "customers",
    indices = [
        Index(
            value = ["shop_id", "deleted_at", "search_key"],
            unique = false,
        ), Index(value = ["shop_id", "updated_at"], unique = false),
    ],
)
data class CustomerEntity(
    @PrimaryKey
    @ColumnInfo(name = "id") val id: String,
    @ColumnInfo(name = "shop_id") val shopId: String,
    @ColumnInfo(name = "name") val name: String,
    @ColumnInfo(name = "search_key") val searchKey: String,
    @ColumnInfo(name = "phone") val phone: String? = null,
    @ColumnInfo(name = "note") val note: String? = null,
    @ColumnInfo(name = "tag") val tag: String? = null,
    @ColumnInfo(name = "sms_consent") val smsConsent: Boolean,
    @ColumnInfo(name = "sms_consent_at") val smsConsentAt: String? = null,
    @ColumnInfo(name = "sms_consent_source") val smsConsentSource: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    @ColumnInfo(name = "deleted_at") val deletedAt: String? = null,
    @ColumnInfo(name = "sync_state") val syncState: String = "PENDING",
)
