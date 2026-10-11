package app.cetele.android.core.data.backup

import app.cetele.android.core.data.database.CeteleDatabase
import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.write.LocalWriteEvents
import app.cetele.android.core.domain.model.ShopRole
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Owner-only encrypted export and import of one shop (`.cetele`, docs/ops/export-format.md).
 * Neither the passphrase nor any row content is logged; the caller wipes the passphrase array.
 */
@Singleton
class BackupService(
    private val databases: DatabaseStore,
    private val clock: Clock,
    private val events: LocalWriteEvents,
    private val codec: BackupCodec,
) {
    @Inject
    constructor(
        databases: DatabaseStore,
        clock: Clock,
        events: LocalWriteEvents,
    ) : this(databases, clock, events, BackupCodec())

    suspend fun export(
        shopId: String,
        passphrase: CharArray,
    ): BackupExportResult {
        val db = databases.get()
        val shop = db.shopDao().get(shopId)?.takeIf { it.role == ShopRole.OWNER.name }
        // Entries first: customers are never hard-deleted, so every entry read finds its customer below.
        val snapshot = shop?.let { snapshot(db, it.id, it.name) }
        if (snapshot == null || !BackupValidator.isValid(snapshot)) {
            return BackupExportResult.Failed(if (shop == null) BackupProblem.NOT_OWNER else BackupProblem.MALFORMED)
        }
        val plain = BackupJson.encodeToString(BackupSnapshot.serializer(), snapshot).toByteArray(Charsets.UTF_8)
        val bytes =
            try {
                withContext(Dispatchers.Default) { codec.encrypt(plain, passphrase) }
            } finally {
                plain.fill(0)
            }
        return BackupExportResult.Ok(bytes, snapshot.shopName, snapshot.customers.size, snapshot.entries.size)
    }

    private suspend fun snapshot(
        db: CeteleDatabase,
        shopId: String,
        shopName: String,
    ): BackupSnapshot {
        val entries =
            db
                .ledgerEntryDao()
                .all(shopId)
                .sortedWith(compareBy({ it.occurredOn }, { it.createdAt }, { it.id }))
        val customers =
            db
                .customerDao()
                .observeAll(shopId)
                .first()
                .sortedBy { it.id }
        return BackupSnapshot(
            shopId = shopId,
            shopName = shopName,
            exportedAt = clock.instant().toString(),
            customers = customers.map(::customer),
            entries = entries.map(::entry),
        )
    }

    /** Decrypts, validates and counts what is new on this device; writes nothing. */
    suspend fun open(
        file: ByteArray,
        passphrase: CharArray,
    ): BackupOpenResult {
        val decoded = decode(file, passphrase)
        val snapshot = decoded.getOrNull()
        val db = databases.get()
        val problem =
            when {
                snapshot == null -> (decoded.exceptionOrNull() as? BackupFormatException)?.failure?.asProblem()
                !BackupValidator.isValid(snapshot) -> BackupProblem.MALFORMED
                !isOwner(db, snapshot.shopId) -> BackupProblem.NOT_OWNER
                else -> null
            }
        if (snapshot == null || problem != null) return BackupOpenResult.Failed(problem ?: BackupProblem.MALFORMED)
        val newCustomers = snapshot.customers.count { db.customerDao().get(snapshot.shopId, it.id) == null }
        val newEntries = snapshot.entries.count { db.ledgerEntryDao().get(snapshot.shopId, it.id) == null }
        return BackupOpenResult.Ok(BackupPreview(snapshot, newCustomers, newEntries))
    }

    /** Format failures and unreadable JSON become a failed result; cancellation still propagates. */
    private suspend fun decode(
        file: ByteArray,
        passphrase: CharArray,
    ): Result<BackupSnapshot> =
        try {
            val plain = withContext(Dispatchers.Default) { BackupCodec.decrypt(file, passphrase) }
            try {
                Result.success(BackupJson.decodeFromString(BackupSnapshot.serializer(), plain.toString(Charsets.UTF_8)))
            } finally {
                plain.fill(0)
            }
        } catch (error: BackupFormatException) {
            Result.failure(error)
        } catch (error: IllegalArgumentException) {
            // kotlinx.serialization's SerializationException is an IllegalArgumentException.
            Result.failure(error)
        }

    /** Adds rows missing on this device with their original ids; rows already present are left alone. */
    suspend fun merge(preview: BackupPreview): BackupMergeResult {
        val snapshot = preview.snapshot
        val db = databases.get()
        val problem =
            when {
                !BackupValidator.isValid(snapshot) -> BackupProblem.MALFORMED
                !isOwner(db, snapshot.shopId) -> BackupProblem.NOT_OWNER
                else -> null
            }
        if (problem != null) return BackupMergeResult.Failed(problem)
        val result = BackupMerger(db, clock).merge(snapshot)
        if (result is BackupMergeResult.Ok && result.addedCustomers + result.addedEntries > 0) {
            events.written(snapshot.shopId)
        }
        return result
    }

    private suspend fun isOwner(
        db: CeteleDatabase,
        shopId: String,
    ): Boolean = db.shopDao().get(shopId)?.role == ShopRole.OWNER.name

    private fun BackupFailure.asProblem(): BackupProblem =
        when (this) {
            BackupFailure.NOT_A_BACKUP -> BackupProblem.NOT_A_BACKUP
            BackupFailure.UNSUPPORTED_VERSION -> BackupProblem.UNSUPPORTED_VERSION
            BackupFailure.MALFORMED -> BackupProblem.MALFORMED
            BackupFailure.AUTHENTICATION -> BackupProblem.AUTHENTICATION
        }

    private fun customer(row: CustomerEntity): BackupCustomer =
        BackupCustomer(
            row.id,
            row.name,
            row.phone,
            row.note,
            row.tag,
            row.smsConsent,
            row.smsConsentAt,
            row.smsConsentSource,
            row.createdAt,
            row.updatedAt,
            row.deletedAt,
            synced = row.syncState == SYNCED,
        )

    private fun entry(row: LedgerEntryEntity): BackupEntry =
        BackupEntry(
            row.id,
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
            synced = row.syncState == SYNCED,
        )

    internal companion object {
        const val SYNCED = "SYNCED"
        const val PENDING = "PENDING"
    }
}
