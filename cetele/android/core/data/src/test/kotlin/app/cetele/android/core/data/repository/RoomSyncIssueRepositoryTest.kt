package app.cetele.android.core.data.repository

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cetele.android.core.data.database.CeteleDatabase
import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.database.TestDatabase
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.media.EncryptedPhotoStore
import app.cetele.android.core.data.sync.OutboxRow
import app.cetele.android.core.data.sync.RoomSyncLocalStore
import app.cetele.android.core.data.sync.SyncFixtures
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RoomSyncIssueRepositoryTest : SyncIssueRepositoryContractTest() {
    private lateinit var db: CeteleDatabase
    private val removed = mutableListOf<String>()
    private val photos = mockk<EncryptedPhotoStore>(relaxed = true)
    override lateinit var store: RoomSyncLocalStore

    @Before fun open() {
        db = TestDatabase.inMemory(ApplicationProvider.getApplicationContext<Context>())
        every { photos.remove(any()) } answers { removed += firstArg<String>() }
        store = RoomSyncLocalStore(DatabaseStore({ db }, {}), SyncFixtures.clock, photos)
    }

    @After fun close() {
        db.close()
    }

    override suspend fun seed(row: OutboxRow) = db.outboxDao().insert(row)

    override suspend fun seed(row: LedgerEntryEntity) = db.ledgerEntryDao().upsert(row)

    override suspend fun entry(id: String): LedgerEntryEntity? = db.ledgerEntryDao().get(SyncFixtures.SHOP, id)

    override fun discardedFile(entryId: String): Boolean = entryId in removed

    @Test fun issuesCarryStateCodeAndUploadState() = runTest { issuesCarryStateCodeAndUploadStateContract() }

    @Test fun dismissOnlyDeletesRejectedOperations() = runTest { dismissOnlyDeletesRejectedOperationsContract() }

    @Test fun sendWithoutPhotoReleasesAFailedUpload() = runTest { sendWithoutPhotoReleasesAFailedUploadContract() }

    @Test fun sendWithoutPhotoKeepsActiveOrFinishedUploads() =
        runTest { sendWithoutPhotoKeepsActiveOrFinishedUploadsContract() }

    @Test fun photoUploadStateFollowsTheUploadRow() = runTest { photoUploadStateFollowsTheUploadRowContract() }
}
