package app.cetele.android.core.data.repository

import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.sync.OutboxRow
import app.cetele.android.core.data.sync.SyncFixtures
import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.sync.SyncLocalStore
import app.cetele.android.core.data.write.LocalWriteEvents
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.OperationStatus
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.CustomerInput
import app.cetele.android.core.network.dto.sync.EntryInput
import app.cetele.android.core.network.dto.sync.OperationResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.serialization.encodeToString
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue

/** One behaviour contract for the repository over every sync local store implementation. */
@OptIn(ExperimentalCoroutinesApi::class)
abstract class SyncIssueRepositoryContractTest {
    protected abstract val store: SyncLocalStore

    protected abstract suspend fun seed(row: OutboxRow)

    protected abstract suspend fun seed(row: LedgerEntryEntity)

    protected abstract suspend fun entry(id: String): LedgerEntryEntity?

    /** Whether the store discarded the local encrypted copy of the entry's photo. */
    protected abstract fun discardedFile(entryId: String): Boolean

    private val events = LocalWriteEvents()
    private val repository by lazy { StoreSyncIssueRepository(store, events) }
    private val at = SyncFixtures.instant.toString()

    private suspend fun photoEntry(
        clientId: String,
        entryId: String,
        photoState: String?,
        code: String? = null,
        order: Long = 1,
    ) {
        val input =
            EntryInput(entryId, "customer", EntryType.DEBT, 100, SyncFixtures.today, photoKey = "media/$SHOP/p.jpg")
        seed(SyncFixtures.entryEntity(input))
        seed(
            SyncFixtures
                .row(clientId, SyncKind.ENTRY_CREATE, entryId, NetworkJson.encodeToString(input), order)
                .copy(photoEntryId = entryId, state = "BLOCKED"),
        )
        if (photoState != null) {
            store.markPhoto(
                PendingPhotoEntity(
                    entryId,
                    SHOP,
                    "encrypted",
                    3,
                    state = photoState,
                    lastCode = code,
                    createdAt = at,
                    updatedAt = at,
                ),
            )
        }
    }

    private suspend fun customerRow(
        clientId: String,
        order: Long,
        change: (OutboxRow) -> OutboxRow = { it },
    ) {
        val input = CustomerInput("customer-$clientId", "Müşteri", smsConsent = false)
        val payload = NetworkJson.encodeToString(input)
        seed(change(SyncFixtures.row(clientId, SyncKind.CUSTOMER_UPSERT, input.id, payload, order)))
    }

    private suspend fun reject(
        clientId: String,
        code: String,
    ) = store.applyResults(SHOP, listOf(OperationResult(clientId, OperationStatus.REJECTED, code = code)), 0)

    protected suspend fun issuesCarryStateCodeAndUploadStateContract() {
        customerRow("queued", 0)
        customerRow("rejected", 2)
        reject("rejected", "forbidden")
        photoEntry("held", "entry-held", "QUEUED", order = 1)
        customerRow("validation", 3) { it.copy(state = "BLOCKED", lastCode = "validation.failed") }

        val issues = repository.observeIssues(SHOP).first()
        assertEquals(listOf("held", "rejected", "validation"), issues.map { it.clientId })
        val held = issues[0]
        assertEquals(SyncIssueState.BLOCKED, held.state)
        assertEquals(SyncKind.ENTRY_CREATE, held.kind)
        assertEquals(PhotoUploadState.Uploading, held.photo)
        assertNull(held.code)
        assertFalse(held.canSendWithoutPhoto)
        assertFalse(held.canDismiss)
        assertEquals(SyncIssueState.REJECTED, issues[1].state)
        assertEquals("forbidden", issues[1].code)
        assertTrue(issues[1].canDismiss)
        assertNull(issues[1].photo)
        assertEquals("validation.failed", issues[2].code)
        assertNull(issues[2].photo)
        assertFalse(issues[2].canSendWithoutPhoto)

        store.markPhoto(store.photo(SHOP, "entry-held")!!.copy(state = "FAILED", lastCode = "media.invalid"))
        val failed = repository.observeIssues(SHOP).first().first()
        assertEquals(PhotoUploadState.Failed("media.invalid"), failed.photo)
        assertEquals("media.invalid", failed.code)
        assertTrue(failed.canSendWithoutPhoto)
        assertEquals(emptyList<SyncIssue>(), repository.observeIssues("other-shop").first())
    }

    protected suspend fun dismissOnlyDeletesRejectedOperationsContract() {
        customerRow("rejected", 1)
        reject("rejected", "conflict")
        photoEntry("held", "entry-held", "FAILED")
        assertEquals(1, repository.observeStatus(SHOP).first().rejectedCount)

        assertFalse(repository.dismiss(SHOP, "held"))
        assertFalse(repository.dismiss(SHOP, "missing"))
        assertFalse(repository.dismiss("other-shop", "rejected"))
        assertTrue(repository.dismiss(SHOP, "rejected"))
        assertFalse(repository.dismiss(SHOP, "rejected"))

        assertEquals(listOf("held"), repository.observeIssues(SHOP).first().map { it.clientId })
        val status = repository.observeStatus(SHOP).first()
        assertEquals(0, status.rejectedCount)
        assertEquals(1, status.blockedCount)
        assertEquals(1, status.pendingCount)
    }

    protected suspend fun TestScope.sendWithoutPhotoReleasesAFailedUploadContract() {
        val written = mutableListOf<String>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { events.events.collect { written += it } }
        photoEntry("held", "entry-held", "FAILED", code = "plan.photo_limit")
        assertEquals(
            PhotoUploadState.Failed("plan.photo_limit"),
            repository.observePhotoUpload(SHOP, "entry-held").first(),
        )
        assertTrue(store.queuedOperations(SHOP, 500).isEmpty())

        assertTrue(repository.sendWithoutPhoto(SHOP, "entry-held"))

        val queued = store.queuedOperations(SHOP, 500).single()
        assertEquals("held", queued.clientId)
        assertNull(queued.photoEntryId)
        assertNull(NetworkJson.decodeFromString<EntryInput>(queued.payloadJson).photoKey)
        assertNull(entry("entry-held")?.photoKey)
        assertTrue(entry("entry-held") != null)
        assertNull(store.photo(SHOP, "entry-held"))
        assertEquals(PhotoUploadState.Absent, repository.observePhotoUpload(SHOP, "entry-held").first())
        assertTrue(repository.observeIssues(SHOP).first().isEmpty())
        assertTrue(discardedFile("entry-held"))
        assertEquals(listOf(SHOP), written)

        assertFalse(repository.sendWithoutPhoto(SHOP, "entry-held"))
        assertEquals(listOf(SHOP), written)
    }

    protected suspend fun sendWithoutPhotoKeepsActiveOrFinishedUploadsContract() {
        photoEntry("queued", "entry-queued", "QUEUED", order = 1)
        photoEntry("uploaded", "entry-uploaded", "UPLOADED", order = 2)
        photoEntry("ready", "entry-ready", "READY", order = 3)
        photoEntry("lost", "entry-lost", null, order = 4)

        assertFalse(repository.sendWithoutPhoto(SHOP, "entry-queued"))
        assertFalse(repository.sendWithoutPhoto(SHOP, "entry-uploaded"))
        assertFalse(repository.sendWithoutPhoto(SHOP, "entry-ready"))
        assertFalse(repository.sendWithoutPhoto(SHOP, "entry-unknown"))
        assertFalse(discardedFile("entry-queued"))
        assertEquals("media/$SHOP/p.jpg", entry("entry-queued")?.photoKey)
        assertEquals("QUEUED", store.photo(SHOP, "entry-queued")?.state)

        // A held entry whose upload row vanished can only leave without its photo.
        val lost = repository.observeIssues(SHOP).first().single { it.clientId == "lost" }
        assertEquals(PhotoUploadState.Absent, lost.photo)
        assertTrue(lost.canSendWithoutPhoto)
        assertTrue(repository.sendWithoutPhoto(SHOP, "entry-lost"))
        assertEquals(listOf("lost"), store.queuedOperations(SHOP, 500).map { it.clientId })
        assertEquals(
            listOf("queued", "uploaded", "ready"),
            repository.observeIssues(SHOP).first().map { it.clientId },
        )
    }

    protected suspend fun photoUploadStateFollowsTheUploadRowContract() {
        assertEquals(PhotoUploadState.Absent, repository.observePhotoUpload(SHOP, "entry-a").first())
        photoEntry("held", "entry-a", "QUEUED")
        assertEquals(PhotoUploadState.Uploading, repository.observePhotoUpload(SHOP, "entry-a").first())
        store.markPhoto(store.photo(SHOP, "entry-a")!!.copy(state = "UPLOADED", mediaId = "media-a"))
        assertEquals(PhotoUploadState.Uploading, repository.observePhotoUpload(SHOP, "entry-a").first())
        store.markPhoto(store.photo(SHOP, "entry-a")!!.copy(state = "FAILED", lastCode = "media.not_ready"))
        assertEquals(
            PhotoUploadState.Failed("media.not_ready"),
            repository.observePhotoUpload(SHOP, "entry-a").first(),
        )
        store.markPhoto(store.photo(SHOP, "entry-a")!!.copy(state = "READY", lastCode = null))
        assertEquals(PhotoUploadState.Ready, repository.observePhotoUpload(SHOP, "entry-a").first())
        assertEquals(PhotoUploadState.Absent, repository.observePhotoUpload("other-shop", "entry-a").first())
    }
}
