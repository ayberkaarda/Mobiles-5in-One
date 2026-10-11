package app.cetele.android.core.data.backup

import androidx.room.Transactor
import androidx.room.immediateTransaction
import androidx.room.useWriterConnection
import app.cetele.android.core.data.database.CeteleDatabase
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.OutboxEntity
import app.cetele.android.core.data.repository.SearchNormalizer
import app.cetele.android.core.domain.id.UuidV7
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.ConsentSource
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.CustomerInput
import app.cetele.android.core.network.dto.sync.EntryInput
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Clock
import java.time.Instant
import java.time.LocalDate

/**
 * Writes a validated snapshot in one immediate transaction. It follows the rules of
 * `LocalWriteService` (row plus outbox operation, correction depends on its original's operation)
 * but keeps the file's ids, which is what makes a second import of the same file a no-op. Rows that
 * had synced before the export are stored as synced and get no outbox operation; the next pull
 * reconciles them with the server. Checks, mapping and outbox writes share the one transaction, so
 * they stay in one class.
 */
@Suppress("TooManyFunctions")
internal class BackupMerger(
    private val db: CeteleDatabase,
    private val clock: Clock,
) {
    suspend fun merge(snapshot: BackupSnapshot): BackupMergeResult =
        db.useWriterConnection { transactor ->
            transactor.immediateTransaction {
                if (conflicts(transactor, snapshot)) {
                    BackupMergeResult.Failed(BackupProblem.CONFLICT)
                } else {
                    write(snapshot)
                }
            }
        }

    private suspend fun conflicts(
        transactor: Transactor,
        snapshot: BackupSnapshot,
    ): Boolean {
        val shopId = snapshot.shopId
        val foreign =
            snapshot.customers.any { heldElsewhere(transactor, CUSTOMER_SHOP, it.id, shopId) } ||
                snapshot.entries.any { heldElsewhere(transactor, ENTRY_SHOP, it.id, shopId) }
        return foreign || snapshot.entries.any { correctionDisagrees(shopId, it) }
    }

    private suspend fun heldElsewhere(
        transactor: Transactor,
        sql: String,
        id: String,
        shopId: String,
    ): Boolean = owner(transactor, sql, id).let { it != null && it != shopId }

    /** A new correction may only link to a local original that is free or already linked to it. */
    private suspend fun correctionDisagrees(
        shopId: String,
        row: BackupEntry,
    ): Boolean {
        val original = row.reverses
        val isNew = db.ledgerEntryDao().get(shopId, row.id) == null
        val local = if (original != null && isNew) db.ledgerEntryDao().get(shopId, original) else null
        return local != null &&
            (
                local.reverses != null ||
                    (local.reversedBy != null && local.reversedBy != row.id) ||
                    local.customerId != row.customerId ||
                    local.amountMinor != row.amountMinor
            )
    }

    private suspend fun write(snapshot: BackupSnapshot): BackupMergeResult {
        val shopId = snapshot.shopId
        val now = clock.instant().toString()
        var customers = 0
        for (row in snapshot.customers) {
            if (db.customerDao().get(shopId, row.id) != null) continue
            db.customerDao().upsert(customerRow(shopId, row))
            if (!row.synced) enqueueCustomer(shopId, row, now)
            customers++
        }
        var entries = 0
        val ordered = snapshot.entries.filter { it.reverses == null } + snapshot.entries.filter { it.reverses != null }
        for (row in ordered) {
            if (db.ledgerEntryDao().get(shopId, row.id) != null) continue
            db.ledgerEntryDao().insert(entryRow(shopId, row))
            if (row.reverses != null) db.ledgerEntryDao().setReversedBy(shopId, row.reverses, row.id)
            if (!row.synced) enqueueEntry(shopId, row, now)
            entries++
        }
        return BackupMergeResult.Ok(customers, entries)
    }

    private suspend fun enqueueCustomer(
        shopId: String,
        row: BackupCustomer,
        now: String,
    ) {
        val input =
            CustomerInput(
                row.id,
                row.name,
                row.phone,
                row.note,
                row.tag,
                row.smsConsent,
                row.smsConsentAt?.let(Instant::parse),
                row.smsConsentSource?.let(ConsentSource::valueOf),
            )
        val payload = NetworkJson.encodeToString(CustomerInput.serializer(), input)
        db.outboxDao().insert(outbox(shopId, SyncKind.CUSTOMER_UPSERT, row.id, payload, now))
        if (row.deletedAt != null) {
            val deletion = buildJsonObject { put("customerId", row.id) }.toString()
            db.outboxDao().insert(outbox(shopId, SyncKind.CUSTOMER_DELETE, row.id, deletion, now))
        }
    }

    private suspend fun enqueueEntry(
        shopId: String,
        row: BackupEntry,
        now: String,
    ) {
        val input =
            EntryInput(
                row.id,
                row.customerId,
                EntryType.valueOf(row.type),
                row.amountMinor,
                LocalDate.parse(row.occurredOn),
                row.dueOn?.let(LocalDate::parse),
                row.note,
                row.photoKey,
                row.reverses,
            )
        val dependency =
            row.reverses?.let { original ->
                db.outboxDao().forEntity(shopId, original).firstOrNull { it.state != "REJECTED" }
            }
        val payload = NetworkJson.encodeToString(EntryInput.serializer(), input)
        db.outboxDao().insert(
            outbox(shopId, SyncKind.ENTRY_CREATE, row.id, payload, now).copy(dependsOnClientId = dependency?.clientId),
        )
    }

    private fun customerRow(
        shopId: String,
        row: BackupCustomer,
    ): CustomerEntity =
        CustomerEntity(
            row.id,
            shopId,
            row.name,
            SearchNormalizer.normalize(row.name),
            row.phone,
            row.note,
            row.tag,
            row.smsConsent,
            row.smsConsentAt,
            row.smsConsentSource,
            row.createdAt,
            row.updatedAt,
            row.deletedAt,
            state(row.synced),
        )

    private fun entryRow(
        shopId: String,
        row: BackupEntry,
    ): LedgerEntryEntity =
        LedgerEntryEntity(
            row.id,
            shopId,
            row.customerId,
            row.type,
            row.amountMinor,
            row.currency,
            row.occurredOn,
            row.dueOn,
            row.note,
            row.photoKey,
            row.reverses,
            row.reversedBy,
            row.createdBy,
            row.createdAt,
            state(row.synced),
        )

    private fun state(synced: Boolean): String = if (synced) BackupService.SYNCED else BackupService.PENDING

    private fun outbox(
        shopId: String,
        kind: SyncKind,
        id: String,
        payload: String,
        now: String,
    ): OutboxEntity =
        OutboxEntity(UuidV7.generate(clock), shopId, kind.name, id, payload, now, state = "QUEUED", updatedAt = now)

    /** The shop that already holds [id] in any shop, so a file cannot move a row across tenants. */
    private suspend fun owner(
        transactor: Transactor,
        sql: String,
        id: String,
    ): String? =
        transactor.usePrepared(sql) { statement ->
            statement.bindText(1, id)
            if (statement.step()) statement.getText(0) else null
        }

    private companion object {
        const val CUSTOMER_SHOP = "SELECT shop_id FROM customers WHERE id = ?"
        const val ENTRY_SHOP = "SELECT shop_id FROM ledger_entries WHERE id = ?"
    }
}
