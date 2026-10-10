package app.cetele.android.core.data.write

import app.cetele.android.core.data.database.CeteleDatabase
import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.OutboxEntity
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.database.writeTransaction
import app.cetele.android.core.data.media.CompressedPhoto
import app.cetele.android.core.data.media.EncryptedPhotoStore
import app.cetele.android.core.data.repository.SearchNormalizer
import app.cetele.android.core.data.repository.asModel
import app.cetele.android.core.data.vault.Vault
import app.cetele.android.core.data.vault.VaultKeys
import app.cetele.android.core.domain.id.UuidV7
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.core.domain.validation.CustomerValidator
import app.cetele.android.core.domain.validation.EntryValidator
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.ConsentSource
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.CustomerInput
import app.cetele.android.core.network.dto.sync.EntryInput
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Clock
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LocalWriteService
    @Inject
    constructor(
        private val databases: DatabaseStore,
        private val clock: Clock,
        private val photos: EncryptedPhotoStore,
        private val vault: Vault,
        private val events: LocalWriteEvents,
    ) {
        suspend fun upsertCustomer(
            shopId: String,
            draft: CustomerDraft,
        ): WriteResult {
            val errors =
                CustomerValidator.validate(
                    draft.name,
                    draft.phone,
                    draft.note,
                    draft.tag,
                    draft.smsConsent,
                    draft.smsConsentAt,
                    draft.smsConsentSource,
                )
            if (errors.isNotEmpty()) return WriteResult.Invalid(errors)
            val db = databases.get()
            val result =
                db.writeTransaction {
                    val id = draft.id ?: UuidV7.generate(clock)
                    val old = db.customerDao().get(shopId, id)
                    if (draft.id != null && old == null) return@writeTransaction invalid("customer.id", "not_found")
                    if (old?.deletedAt != null) return@writeTransaction invalid("customer.id", "customer.deleted")
                    val now = clock.instant().toString()
                    val row =
                        CustomerEntity(
                            id,
                            shopId,
                            draft.name.trim(),
                            SearchNormalizer.normalize(draft.name),
                            draft.phone,
                            draft.note,
                            draft.tag,
                            draft.smsConsent,
                            draft.smsConsentAt?.toString(),
                            draft.smsConsentSource?.name,
                            old?.createdAt ?: now,
                            now,
                            null,
                            "PENDING",
                        )
                    val input =
                        CustomerInput(
                            id,
                            row.name,
                            row.phone,
                            row.note,
                            row.tag,
                            row.smsConsent,
                            draft.smsConsentAt,
                            draft.smsConsentSource?.let { ConsentSource.valueOf(it.name) },
                        )
                    db.customerDao().upsert(row)
                    db.outboxDao().insert(
                        outbox(shopId, SyncKind.CUSTOMER_UPSERT, id, NetworkJson.encodeToString(input), now),
                    )
                    WriteResult.Ok(id)
                }
            return publish(shopId, result)
        }

        suspend fun deleteCustomer(
            shopId: String,
            id: String,
        ): WriteResult {
            val db = databases.get()
            val result =
                db.writeTransaction {
                    val row =
                        db.customerDao().get(shopId, id) ?: return@writeTransaction invalid("customer.id", "not_found")
                    if (row.deletedAt != null) return@writeTransaction invalid("customer.id", "customer.deleted")
                    val now = clock.instant().toString()
                    db.customerDao().markDeleted(shopId, id, now)
                    val payload = buildJsonObject { put("customerId", id) }.toString()
                    db.outboxDao().insert(outbox(shopId, SyncKind.CUSTOMER_DELETE, id, payload, now))
                    WriteResult.Ok(id)
                }
            return publish(shopId, result)
        }

        suspend fun createEntry(
            shopId: String,
            draft: EntryDraft,
            photo: CompressedPhoto? = null,
        ): WriteResult {
            val errors =
                EntryDraftChecks.errors(shopId, draft, CeteleClock.today(clock)) + EntryDraftChecks.photoErrors(photo)
            if (errors.isNotEmpty()) return WriteResult.Invalid(errors)
            val db = databases.get()
            val id = UuidV7.generate(clock)
            var finished = false
            val result =
                try {
                    db.writeTransaction { insertNewEntry(db, shopId, id, draft, photo) }.also { finished = true }
                } finally {
                    // A failed or cancelled transaction must not leave an orphaned encrypted photo behind.
                    if (!finished && photo != null) photos.remove(id)
                }
            return publish(shopId, result)
        }

        /** Entry row, optional encrypted photo with its upload row, and the outbox row: all or nothing. */
        private suspend fun insertNewEntry(
            db: CeteleDatabase,
            shopId: String,
            id: String,
            draft: EntryDraft,
            photo: CompressedPhoto?,
        ): WriteResult {
            val customer = db.customerDao().get(shopId, draft.customerId)
            if (customer == null || customer.deletedAt != null) return invalid("entry.customerId", "customer.deleted")
            val now = clock.instant().toString()
            val input =
                EntryInput(
                    id,
                    draft.customerId,
                    EntryType.valueOf(draft.type.name),
                    draft.amountMinor,
                    draft.occurredOn,
                    draft.dueOn,
                    draft.note,
                    draft.photoKey,
                )
            insertEntry(db, shopId, input, now)
            val operation = outbox(shopId, SyncKind.ENTRY_CREATE, id, NetworkJson.encodeToString(input), now)
            if (photo == null) {
                db.outboxDao().insert(operation)
            } else {
                val path = photos.save(id, photo.bytes, pending = true)
                db.pendingPhotoDao().upsert(
                    PendingPhotoEntity(id, shopId, path, photo.bytes.size, null, null, "QUEUED", 0, null, now, now),
                )
                db.outboxDao().insert(operation.copy(state = "BLOCKED", photoEntryId = id))
            }
            return WriteResult.Ok(id)
        }

        suspend fun reverseEntry(
            shopId: String,
            originalId: String,
            today: LocalDate,
        ): WriteResult {
            val db = databases.get()
            val result =
                db.writeTransaction {
                    val original =
                        db.ledgerEntryDao().get(shopId, originalId)?.asModel()
                            ?: return@writeTransaction invalid("entry.reverses", "not_found")
                    val customer = db.customerDao().get(shopId, original.customerId)
                    if (customer == null ||
                        customer.deletedAt != null
                    ) {
                        return@writeTransaction invalid("entry.customerId", "customer.deleted")
                    }
                    if (!EntryValidator.canReverse(
                            original,
                        )
                    ) {
                        return@writeTransaction invalid("entry.reverses", "ledger.already_reversed")
                    }
                    val draft = EntryValidator.reversalOf(original, today)
                    val errors =
                        EntryValidator.validate(
                            draft.type,
                            draft.amount.minor,
                            today,
                            null,
                            null,
                            null,
                            originalId,
                            CeteleClock.today(clock),
                        )
                    if (errors.isNotEmpty()) return@writeTransaction WriteResult.Invalid(errors)
                    val id = UuidV7.generate(clock)
                    val now = clock.instant().toString()
                    val input =
                        EntryInput(
                            id,
                            original.customerId,
                            EntryType.valueOf(original.type.name),
                            original.amount.minor,
                            today,
                            reverses = originalId,
                        )
                    val dependency = db.outboxDao().forEntity(shopId, originalId).firstOrNull { it.state != "REJECTED" }
                    insertEntry(db, shopId, input, now)
                    db.ledgerEntryDao().setReversedBy(shopId, originalId, id)
                    db.outboxDao().insert(
                        outbox(shopId, SyncKind.ENTRY_CREATE, id, NetworkJson.encodeToString(input), now)
                            .copy(dependsOnClientId = dependency?.clientId),
                    )
                    WriteResult.Ok(id)
                }
            return publish(shopId, result)
        }

        private suspend fun insertEntry(
            db: CeteleDatabase,
            shopId: String,
            input: EntryInput,
            now: String,
        ) {
            db.ledgerEntryDao().insert(
                LedgerEntryEntity(
                    input.id,
                    shopId,
                    input.customerId,
                    input.type.name,
                    input.amountMinor,
                    "TRY",
                    input.occurredOn.toString(),
                    input.dueOn?.toString(),
                    input.note,
                    input.photoKey,
                    input.reverses,
                    null,
                    vault.get(VaultKeys.USER_ID)?.toString(Charsets.UTF_8),
                    now,
                    "PENDING",
                ),
            )
        }

        private fun outbox(
            shopId: String,
            kind: SyncKind,
            id: String,
            payload: String,
            now: String,
        ): OutboxEntity =
            OutboxEntity(
                UuidV7.generate(clock),
                shopId,
                kind.name,
                id,
                payload,
                now,
                null,
                null,
                null,
                "QUEUED",
                0,
                null,
                null,
                now,
            )

        private fun invalid(
            field: String,
            code: String,
        ): WriteResult.Invalid = WriteResult.Invalid(listOf(FieldError(field, code)))

        private suspend fun publish(
            shopId: String,
            result: WriteResult,
        ): WriteResult {
            if (result is WriteResult.Ok) events.written(shopId)
            return result
        }
    }
