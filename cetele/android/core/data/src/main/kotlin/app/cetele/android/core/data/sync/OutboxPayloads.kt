package app.cetele.android.core.data.sync

import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.repository.SearchNormalizer
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.CustomerInput
import app.cetele.android.core.network.dto.sync.CustomerSnapshot
import app.cetele.android.core.network.dto.sync.EntryInput
import app.cetele.android.core.network.dto.sync.EntrySnapshot
import app.cetele.android.core.network.dto.sync.SyncOperation
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

object OutboxPayloads {
    private const val ACKNOWLEDGED = "serverAcknowledged"

    fun operation(
        row: OutboxRow,
        seq: Long,
        photoKey: String?,
    ): SyncOperation {
        val kind = SyncKind.valueOf(row.kind)
        return when (kind) {
            SyncKind.CUSTOMER_UPSERT -> {
                SyncOperation(
                    row.clientId,
                    seq,
                    kind,
                    customer = NetworkJson.decodeFromString<CustomerInput>(row.payloadJson),
                )
            }

            SyncKind.CUSTOMER_DELETE -> {
                SyncOperation(
                    row.clientId,
                    seq,
                    kind,
                    customerId =
                        NetworkJson
                            .parseToJsonElement(row.payloadJson)
                            .jsonObject
                            .getValue("customerId")
                            .jsonPrimitive.content,
                )
            }

            SyncKind.ENTRY_CREATE -> {
                val entry = NetworkJson.decodeFromString<EntryInput>(row.payloadJson)
                SyncOperation(row.clientId, seq, kind, entry = entry.copy(photoKey = photoKey ?: entry.photoKey))
            }
        }
    }

    fun acknowledge(row: OutboxRow): OutboxRow {
        val payload = NetworkJson.parseToJsonElement(row.payloadJson).jsonObject
        return row.copy(payloadJson = JsonObject(payload + (ACKNOWLEDGED to JsonPrimitive(true))).toString())
    }

    fun acknowledged(row: OutboxRow): Boolean =
        NetworkJson
            .parseToJsonElement(row.payloadJson)
            .jsonObject[ACKNOWLEDGED]
            ?.jsonPrimitive
            ?.content == "true"
}

internal fun CustomerSnapshot.asEntity(
    shopId: String,
    pending: Boolean,
): CustomerEntity =
    CustomerEntity(
        id,
        shopId,
        name,
        SearchNormalizer.normalize(name),
        phone,
        note,
        tag,
        smsConsent,
        smsConsentAt?.toString(),
        smsConsentSource?.name,
        createdAt.toString(),
        updatedAt.toString(),
        deletedAt?.toString(),
        if (pending) "PENDING" else "SYNCED",
    )

internal fun EntrySnapshot.asEntity(shopId: String): LedgerEntryEntity =
    LedgerEntryEntity(
        id,
        shopId,
        customerId,
        type.name,
        amountMinor,
        currency,
        occurredOn.toString(),
        dueOn?.toString(),
        note,
        photoKey,
        reverses,
        reversedBy,
        createdBy,
        createdAt.toString(),
        "SYNCED",
    )
