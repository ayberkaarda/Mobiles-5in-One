package app.cetele.android.feature.settings.sync

import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.database.entity.OutboxEntity
import app.cetele.android.core.data.database.writeTransaction
import app.cetele.android.core.data.write.LocalWriteEvents
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.sync.EntryInput
import kotlinx.coroutines.flow.Flow
import java.time.Clock
import javax.inject.Inject

interface SettingsIssueStore {
    fun observe(shopId: String): Flow<List<OutboxEntity>>

    suspend fun remove(
        shopId: String,
        clientId: String,
    ): Boolean

    suspend fun withoutPhoto(
        shopId: String,
        clientId: String,
    ): Boolean
}

class RoomSettingsIssueStore
    @Inject
    constructor(
        private val databases: DatabaseStore,
        private val events: LocalWriteEvents,
        private val clock: Clock,
    ) : SettingsIssueStore {
        override fun observe(shopId: String): Flow<List<OutboxEntity>> =
            databases.get().outboxDao().observeIssues(shopId)

        override suspend fun remove(
            shopId: String,
            clientId: String,
        ): Boolean {
            val db = databases.get()
            return db.writeTransaction {
                val row = db.outboxDao().get(shopId, clientId)
                if (row?.state != "REJECTED") {
                    false
                } else {
                    db.outboxDao().delete(shopId, clientId)
                    true
                }
            }
        }

        override suspend fun withoutPhoto(
            shopId: String,
            clientId: String,
        ): Boolean {
            val db = databases.get()
            val changed =
                db.writeTransaction {
                    val row = db.outboxDao().get(shopId, clientId)
                    if (row == null || !canSendWithoutPhoto(row)) return@writeTransaction false
                    val entryId = row.photoEntryId ?: return@writeTransaction false
                    val entry = NetworkJson.decodeFromString<EntryInput>(row.payloadJson)
                    val payload = NetworkJson.encodeToString(EntryInput.serializer(), entry.copy(photoKey = null))
                    db.pendingPhotoDao().delete(shopId, entryId)
                    db.ledgerEntryDao().setPhotoKey(shopId, entryId, null)
                    db.outboxDao().upsert(
                        row.copy(
                            payloadJson = payload,
                            photoEntryId = null,
                            state = "QUEUED",
                            lastCode = null,
                            errorsJson = null,
                            updatedAt = clock.instant().toString(),
                        ),
                    )
                    true
                }
            if (changed) events.written(shopId)
            return changed
        }
    }

internal fun canSendWithoutPhoto(row: OutboxEntity): Boolean =
    row.state == "BLOCKED" && row.photoEntryId != null && row.kind == "ENTRY_CREATE" &&
        (row.lastCode == null || row.lastCode?.startsWith("media.") == true || row.lastCode == "plan.photo_limit")
