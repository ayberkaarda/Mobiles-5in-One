package app.cetele.android.core.data.sync

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.media.EncryptedPhotoStore
import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.sync.fake.FakeSyncServer
import app.cetele.android.core.data.vault.InMemoryVault
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.EntryInput
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class PhotoUploadWorkerTest {
    @Test fun signedHeadersAndBytesReachUploadAndReadyUnblocksEntry() =
        runTest {
            val fixture = fixture()
            assertEquals(ListenableWorker.Result.success(), fixture.worker.doWork())
            val upload =
                fixture.server.media.uploads
                    .single()
            assertEquals(
                mapOf("Content-Type" to "image/jpeg", "Content-Length" to "4", "X-Upload-Mode" to "photo"),
                upload.view.headers,
            )
            assertArrayEquals(fixture.bytes, upload.bytes)
            assertEquals("READY", fixture.store.photo(SHOP, "entry")?.state)
            assertEquals(
                "QUEUED",
                fixture.store.operations
                    .getValue(SHOP to "operation")
                    .state,
            )
            assertEquals(
                upload.view.photoKey,
                PushBatchBuilder(fixture.store)
                    .build(SHOP)
                    .operations
                    .single()
                    .entry
                    ?.photoKey,
            )
            verify { fixture.scheduler.requestNow(SHOP) }
            fixture.worker.doWork()
            assertEquals(1, fixture.server.media.uploads.size)
        }

    @Test fun invalidMediaIsFailedAndRemainsBlockedUntilPhotoRemoved() =
        runTest {
            val fixture = fixture()
            fixture.server.media.completeFailure = "media.invalid"
            fixture.worker.doWork()
            assertEquals("FAILED", fixture.store.photo(SHOP, "entry")?.state)
            assertEquals("media.invalid", fixture.store.photo(SHOP, "entry")?.lastCode)
            assertEquals(
                "BLOCKED",
                fixture.store.operations
                    .getValue(SHOP to "operation")
                    .state,
            )
            assertTrue(fixture.store.queuedOperations(SHOP, 500).isEmpty())
            verify(exactly = 0) { fixture.scheduler.requestNow(any()) }
            fixture.store.removePhoto(SHOP, "entry")
            assertEquals(null, fixture.store.photo(SHOP, "entry"))
            assertEquals(
                null,
                PushBatchBuilder(fixture.store)
                    .build(SHOP)
                    .operations
                    .single()
                    .entry
                    ?.photoKey,
            )
        }

    @Test fun uploadedPhotoResumesCompletionWithoutAnotherPut() =
        runTest {
            val fixture = fixture()
            val presign =
                fixture.server.media
                    .presign(
                        SHOP,
                        app.cetele.android.core.network.dto.media
                            .MediaPresignRequest("image/jpeg", fixture.bytes.size),
                    ).getOrNull()!!
            fixture.server.media.upload(presign, fixture.bytes)
            fixture.store.markPhoto(
                fixture.store
                    .photo(
                        SHOP,
                        "entry",
                    )!!
                    .copy(state = "UPLOADED", mediaId = presign.mediaId, photoKey = presign.photoKey),
            )
            fixture.worker.doWork()
            assertEquals(1, fixture.server.media.presigns.size)
            assertEquals(1, fixture.server.media.uploads.size)
            assertEquals("READY", fixture.store.photo(SHOP, "entry")?.state)
        }

    private data class Fixture(
        val worker: PhotoUploadWorker,
        val store: InMemorySyncLocalStore,
        val server: FakeSyncServer,
        val scheduler: SyncScheduler,
        val bytes: ByteArray,
    )

    private suspend fun fixture(): Fixture {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = InMemorySyncLocalStore()
        val server = FakeSyncServer()
        val scheduler = mockk<SyncScheduler>(relaxed = true)
        val photos = EncryptedPhotoStore(File(context.cacheDir, "photos-${UUID.randomUUID()}"), InMemoryVault())
        val bytes = byteArrayOf(1, 2, 3, 4)
        val path = photos.save("entry", bytes, pending = true)
        val at = SyncFixtures.instant.toString()
        val input = EntryInput("entry", "customer", EntryType.DEBT, 100, SyncFixtures.today)
        store.seed(SyncFixtures.entryEntity(input))
        store.seed(
            SyncFixtures
                .row(
                    "operation",
                    SyncKind.ENTRY_CREATE,
                    input.id,
                    NetworkJson.encodeToString(input),
                ).copy(state = "BLOCKED", photoEntryId = input.id),
        )
        store.markPhoto(
            PendingPhotoEntity(input.id, SHOP, path, bytes.size, state = "QUEUED", createdAt = at, updatedAt = at),
        )
        val factory =
            object : WorkerFactory() {
                override fun createWorker(
                    appContext: Context,
                    workerClassName: String,
                    workerParameters: WorkerParameters,
                ): ListenableWorker =
                    PhotoUploadWorker(
                        appContext,
                        workerParameters,
                        store,
                        server.media,
                        photos,
                        scheduler,
                        SyncFixtures.clock,
                        mockk(relaxed = true),
                    )
            }
        val worker =
            TestListenableWorkerBuilder<PhotoUploadWorker>(context)
                .setWorkerFactory(factory)
                .setInputData(
                    workDataOf(
                        SyncScheduler.SHOP_ID to SHOP,
                        SyncScheduler.ENTRY_ID to input.id,
                    ),
                ).build()
        return Fixture(worker, store, server, scheduler, bytes)
    }
}
