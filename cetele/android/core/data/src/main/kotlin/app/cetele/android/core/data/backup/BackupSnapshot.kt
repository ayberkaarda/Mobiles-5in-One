package app.cetele.android.core.data.backup

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Plaintext inside a `.cetele` file. Photo keys travel; photo bytes do not. */
@Serializable
data class BackupSnapshot(
    val schema: Int = SCHEMA,
    val shopId: String,
    val shopName: String,
    val exportedAt: String,
    val customers: List<BackupCustomer>,
    val entries: List<BackupEntry>,
) {
    companion object {
        const val SCHEMA = 1
    }
}

@Serializable
data class BackupCustomer(
    val id: String,
    val name: String,
    val phone: String? = null,
    val note: String? = null,
    val tag: String? = null,
    val smsConsent: Boolean,
    val smsConsentAt: String? = null,
    val smsConsentSource: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String? = null,
    val synced: Boolean,
)

@Serializable
data class BackupEntry(
    val id: String,
    val customerId: String,
    val type: String,
    val amountMinor: Long,
    val currency: String,
    val occurredOn: String,
    val dueOn: String? = null,
    val note: String? = null,
    val photoKey: String? = null,
    val reverses: String? = null,
    val reversedBy: String? = null,
    val createdBy: String? = null,
    val createdAt: String,
    val synced: Boolean,
)

internal val BackupJson: Json =
    Json {
        ignoreUnknownKeys = false
        explicitNulls = false
        encodeDefaults = true
    }
