package app.cetele.android.feature.ledger

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.media.CompressedPhoto
import app.cetele.android.core.data.media.ImageCompressor
import app.cetele.android.core.data.repository.LedgerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.write.EntryDraft
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.feature.ledger.entry.EntryEditViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
class EntryEditViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val ledger = mockk<LedgerRepository>()
    private val shops = mockk<ShopRepository>()
    private val draft = slot<EntryDraft>()
    private val compressor = mockk<ImageCompressor>()
    private lateinit var model: EntryEditViewModel

    @BeforeEach
    fun prepare() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns MutableStateFlow(LedgerFixtures.shop())
        coEvery { ledger.create("shop-a", capture(draft), any()) } returns WriteResult.Ok("saved-entry")
        model =
            EntryEditViewModel(
                SavedStateHandle(mapOf("customerId" to "customer-a", "type" to EntryType.DEBT.name)),
                ledger,
                shops,
                compressor,
                LedgerFixtures.clock,
            )
    }

    @AfterEach
    fun finish() {
        model.viewModelScope.cancel()
        Dispatchers.resetMain()
    }

    @Test
    fun commaAmountIsSavedInMinorUnitsOnce() =
        runTest(dispatcher) {
            runCurrent()
            assertEquals(LedgerFixtures.today, model.state.value.occurredOn)
            model.setAmountText("12,50")
            model.save()
            model.save()
            runCurrent()
            assertEquals(1250L, draft.captured.amountMinor)
            assertEquals("customer-a", draft.captured.customerId)
            assertEquals("saved-entry", model.state.value.savedId)
            model.save()
            coVerify(exactly = 1) { ledger.create("shop-a", any(), null) }
        }

    @Test
    fun invalidAmountsHaveTheValidatorCodeAndNeverWrite() =
        runTest(dispatcher) {
            runCurrent()
            listOf("0", "-12", "12,500", "100000000,01", "abc").forEach { text ->
                model.setAmountText(text)
                model.save()
                assertTrue(FieldError("entry.amountMinor", "out_of_range") in model.state.value.errors)
            }
            coVerify(exactly = 0) { ledger.create(any(), any(), any()) }
        }

    @Test
    fun changingToPaymentClearsDueDateAndIgnoresNewDueDate() =
        runTest(dispatcher) {
            runCurrent()
            model.setAmountText("12,50")
            model.setDueOn(LedgerFixtures.today.plusDays(10))
            assertEquals(LedgerFixtures.today.plusDays(10), model.state.value.dueOn)
            model.setType(EntryType.PAYMENT)
            model.setDueOn(LedgerFixtures.today.plusDays(5))
            assertNull(model.state.value.dueOn)
            model.save()
            runCurrent()
            assertEquals(EntryType.PAYMENT, draft.captured.type)
            assertNull(draft.captured.dueOn)
        }

    @Test
    fun tomorrowIsAcceptedAndDayAfterTomorrowIsRejected() =
        runTest(dispatcher) {
            runCurrent()
            model.setAmount(1250)
            model.setOccurredOn(LedgerFixtures.today.plusDays(2))
            model.save()
            assertEquals(listOf(FieldError("entry.occurredOn", "out_of_range")), model.state.value.errors)
            coVerify(exactly = 0) { ledger.create(any(), any(), any()) }
            model.setOccurredOn(LedgerFixtures.today.plusDays(1))
            model.save()
            runCurrent()
            assertEquals(LedgerFixtures.today.plusDays(1), draft.captured.occurredOn)
        }

    @Test
    fun photoPlanUsesTheSizeLimitAndQualityLadderAndPhotoIsPassedToTheWrite() =
        runTest(dispatcher) {
            runCurrent()
            val plan = model.photoPlan(3200, 2400, 2_000_000)
            assertEquals(listOf(85, 75, 65), plan.map { it.quality })
            assertTrue(plan.all { it.scale == 0.5f })
            val photo = CompressedPhoto(byteArrayOf(1, 2, 3), 1600, 1200)
            model.acceptPhoto(photo)
            assertSame(photo, model.state.value.photo)
            model.setAmount(1250)
            model.save()
            runCurrent()
            coVerify(exactly = 1) { ledger.create("shop-a", any(), photo) }
            assertNull(model.state.value.photo)
        }

    @Test
    fun oversizePhotoIsRefusedAndRemovalClearsTheError() =
        runTest(dispatcher) {
            model.acceptPhoto(CompressedPhoto(ByteArray(Limits.PHOTO_MAX_BYTES + 1), 100, 100))
            assertTrue(model.state.value.photoFailed)
            assertNull(model.state.value.photo)
            model.removePhoto()
            assertFalse(model.state.value.photoFailed)
        }

    @Test
    fun noteAndRepositoryValidationErrorsArePreserved() =
        runTest(dispatcher) {
            runCurrent()
            model.setAmount(1250)
            model.setNote("a".repeat(Limits.NOTE_MAX + 1))
            model.save()
            assertEquals(listOf(FieldError("entry.note", "too_long")), model.state.value.errors)
            model.setNote("Ekmek")
            val error = FieldError("entry.customerId", "customer.deleted")
            coEvery { ledger.create(any(), any(), any()) } returns WriteResult.Invalid(listOf(error))
            model.save()
            runCurrent()
            assertEquals(listOf(error), model.state.value.errors)
            assertNull(model.state.value.savedId)
            assertFalse(model.state.value.busy)
        }

    @Test
    fun captureArrivingWhileSavingIsDeletedAndNotCompressed() =
        runTest(dispatcher) {
            runCurrent()
            val capture = File.createTempFile("receipt-", ".jpg")
            model.setAmount(1250)
            model.save()
            assertTrue(model.state.value.busy)
            model.compressCapture(capture)
            assertFalse(capture.exists())
            runCurrent()
            coVerify(exactly = 0) { compressor.compress(any()) }
        }
}
