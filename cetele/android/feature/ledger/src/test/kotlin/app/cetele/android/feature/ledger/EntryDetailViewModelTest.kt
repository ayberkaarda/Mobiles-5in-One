package app.cetele.android.feature.ledger

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.feature.ledger.entry.EntryDetailViewModel
import app.cetele.android.feature.ledger.photo.EntryPhotoStatus
import app.cetele.android.feature.ledger.photo.EntryPhotos
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EntryDetailViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val ledger = mockk<LedgerRepository>()
    private val shops = mockk<ShopRepository>()
    private val photos = mockk<EntryPhotos>()
    private val entries = MutableStateFlow(listOf(LedgerFixtures.entry()))
    private val upload = MutableStateFlow(EntryPhotoStatus.Absent)
    private lateinit var model: EntryDetailViewModel

    @BeforeEach
    fun prepare() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns MutableStateFlow(LedgerFixtures.shop())
        every { ledger.observeAll("shop-a") } returns entries
        every { photos.observe(any()) } returns upload
        model =
            EntryDetailViewModel(
                SavedStateHandle(mapOf("entryId" to "entry-a")),
                ledger,
                shops,
                photos,
                LedgerFixtures.clock,
                mockk(),
            )
    }

    @AfterEach
    fun finish() {
        model.viewModelScope.cancel()
        Dispatchers.resetMain()
    }

    @Test
    fun reversalRequiresAnOpenConfirmationAndRefreshesTheLinkedEntry() =
        modelTest {
            runCurrent()
            model.confirmReversal()
            coVerify(exactly = 0) { ledger.reverse(any(), any(), any()) }
            coEvery { ledger.reverse("shop-a", "entry-a", LedgerFixtures.today) } returns WriteResult.Ok("correction-a")
            coEvery { ledger.get("shop-a", "entry-a") } returns LedgerFixtures.entry(reversedBy = "correction-a")
            model.requestReversal()
            model.confirmReversal()
            model.confirmReversal()
            runCurrent()
            assertEquals(
                "correction-a",
                model.state.value.entry
                    ?.reversedBy,
            )
            assertFalse(model.state.value.confirmReversal)
            assertFalse(model.state.value.busy)
            model.requestReversal()
            assertFalse(model.state.value.confirmReversal)
            coVerify(exactly = 1) { ledger.reverse("shop-a", "entry-a", LedgerFixtures.today) }
        }

    @Test
    fun serverConstraintFromTheLocalWriteIsShownWithoutDismissingTheEntry() =
        modelTest {
            runCurrent()
            val error = FieldError("entry.reverses", "ledger.already_reversed")
            coEvery { ledger.reverse(any(), any(), any()) } returns WriteResult.Invalid(listOf(error))
            model.requestReversal()
            model.confirmReversal()
            runCurrent()
            assertEquals(listOf(error), model.state.value.errors)
            assertEquals(
                "entry-a",
                model.state.value.entry
                    ?.id,
            )
            assertFalse(model.state.value.confirmReversal)
        }

    @Test
    fun photoStatusFollowsTheObservedEntry() =
        modelTest {
            runCurrent()
            assertEquals(EntryPhotoStatus.Absent, model.state.value.photoStatus)
            upload.value = EntryPhotoStatus.Uploading
            runCurrent()
            assertEquals(EntryPhotoStatus.Uploading, model.state.value.photoStatus)
            upload.value = EntryPhotoStatus.Failed
            runCurrent()
            assertEquals(EntryPhotoStatus.Failed, model.state.value.photoStatus)
            val uploaded = LedgerFixtures.entry().copy(photoKey = "media/shop-a/photo-a.jpg")
            val ready = MutableStateFlow(EntryPhotoStatus.Ready)
            every { photos.observe(uploaded) } returns ready
            entries.value = listOf(uploaded)
            runCurrent()
            assertEquals(EntryPhotoStatus.Ready, model.state.value.photoStatus)
            assertEquals(
                "media/shop-a/photo-a.jpg",
                model.state.value.entry
                    ?.photoKey,
            )
        }

    @Test
    fun sendWithoutPhotoIsOnlyOfferedAfterAFailedUpload() =
        modelTest {
            coEvery { photos.sendWithoutPhoto(any()) } returns true
            upload.value = EntryPhotoStatus.Uploading
            runCurrent()
            model.sendWithoutPhoto()
            runCurrent()
            coVerify(exactly = 0) { photos.sendWithoutPhoto(any()) }
            upload.value = EntryPhotoStatus.Failed
            runCurrent()
            model.sendWithoutPhoto()
            runCurrent()
            coVerify(exactly = 1) { photos.sendWithoutPhoto(LedgerFixtures.entry()) }
            assertFalse(model.state.value.busy)
            assertFalse(model.state.value.failed)
            upload.value = EntryPhotoStatus.Absent
            runCurrent()
            assertEquals(EntryPhotoStatus.Absent, model.state.value.photoStatus)
            model.sendWithoutPhoto()
            runCurrent()
            coVerify(exactly = 1) { photos.sendWithoutPhoto(any()) }
        }

    @Test
    fun missingEntryIsReportedAfterLoading() =
        modelTest {
            runCurrent()
            entries.value = emptyList()
            runCurrent()
            assertNull(model.state.value.entry)
            assertFalse(model.state.value.loading)
            assertEquals(EntryPhotoStatus.Absent, model.state.value.photoStatus)
        }

    private fun modelTest(block: suspend TestScope.() -> Unit) =
        runTest(dispatcher) {
            try {
                block()
            } finally {
                model.viewModelScope.cancel()
            }
        }
}
