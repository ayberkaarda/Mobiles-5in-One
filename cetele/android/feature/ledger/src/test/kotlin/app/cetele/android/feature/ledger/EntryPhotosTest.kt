package app.cetele.android.feature.ledger

import app.cetele.android.core.data.media.PhotoRepository
import app.cetele.android.core.data.repository.PhotoUploadState
import app.cetele.android.core.data.repository.SyncIssueRepository
import app.cetele.android.feature.ledger.photo.EntryPhotoStatus
import app.cetele.android.feature.ledger.photo.EntryPhotos
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class EntryPhotosTest {
    private val photos = mockk<PhotoRepository>()
    private val uploads = mockk<SyncIssueRepository>()
    private val state = MutableStateFlow<PhotoUploadState>(PhotoUploadState.Absent)
    private val subject = EntryPhotos(photos, uploads)

    @Test
    fun uploadPipelineStateWinsAndServerKeyOrLocalCopyFillTheGap() =
        runTest {
            every { uploads.observePhotoUpload("shop-a", "entry-a") } returns state
            val entry = LedgerFixtures.entry()
            coEvery { photos.open("entry-a") } returns null
            assertEquals(EntryPhotoStatus.Absent, subject.observe(entry).first())
            coEvery { photos.open("entry-a") } returns byteArrayOf(1)
            assertEquals(EntryPhotoStatus.Uploading, subject.observe(entry).first())
            assertEquals(
                EntryPhotoStatus.Ready,
                subject.observe(entry.copy(photoKey = "media/shop-a/photo-a.jpg")).first(),
            )
            state.value = PhotoUploadState.Uploading
            assertEquals(EntryPhotoStatus.Uploading, subject.observe(entry).first())
            state.value = PhotoUploadState.Failed("media.invalid")
            assertEquals(EntryPhotoStatus.Failed, subject.observe(entry).first())
            state.value = PhotoUploadState.Ready
            assertEquals(EntryPhotoStatus.Ready, subject.observe(entry).first())
        }

    @Test
    fun sendWithoutPhotoGoesThroughTheRepositoryForTheEntryShop() =
        runTest {
            coEvery { uploads.sendWithoutPhoto("shop-a", "entry-a") } returns true
            assertTrue(subject.sendWithoutPhoto(LedgerFixtures.entry()))
            coVerify(exactly = 1) { uploads.sendWithoutPhoto("shop-a", "entry-a") }
        }
}
