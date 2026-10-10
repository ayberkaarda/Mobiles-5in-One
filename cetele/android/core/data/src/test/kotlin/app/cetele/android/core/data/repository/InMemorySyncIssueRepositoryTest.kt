package app.cetele.android.core.data.repository

import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.sync.InMemorySyncLocalStore
import app.cetele.android.core.data.sync.OutboxRow
import app.cetele.android.core.data.sync.SyncFixtures
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Test

class InMemorySyncIssueRepositoryTest : SyncIssueRepositoryContractTest() {
    override val store = InMemorySyncLocalStore()

    override suspend fun seed(row: OutboxRow) = store.seed(row)

    override suspend fun seed(row: LedgerEntryEntity) = store.seed(row)

    override suspend fun entry(id: String): LedgerEntryEntity? = store.entries[SyncFixtures.SHOP to id]

    override fun discardedFile(entryId: String): Boolean = entryId in store.discardedFiles

    @Test fun issuesCarryStateCodeAndUploadState() = runTest { issuesCarryStateCodeAndUploadStateContract() }

    @Test fun dismissOnlyDeletesRejectedOperations() = runTest { dismissOnlyDeletesRejectedOperationsContract() }

    @Test fun sendWithoutPhotoReleasesAFailedUpload() = runTest { sendWithoutPhotoReleasesAFailedUploadContract() }

    @Test fun sendWithoutPhotoKeepsActiveOrFinishedUploads() =
        runTest { sendWithoutPhotoKeepsActiveOrFinishedUploadsContract() }

    @Test fun photoUploadStateFollowsTheUploadRow() = runTest { photoUploadStateFollowsTheUploadRowContract() }
}
