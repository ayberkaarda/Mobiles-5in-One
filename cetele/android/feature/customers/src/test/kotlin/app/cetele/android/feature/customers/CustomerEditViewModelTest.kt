package app.cetele.android.feature.customers

import androidx.lifecycle.SavedStateHandle
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.write.CustomerDraft
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.model.ConsentSource
import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.validation.CustomerValidator
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.feature.customers.edit.CustomerEditState
import app.cetele.android.feature.customers.edit.CustomerEditViewModel
import app.cetele.android.feature.customers.edit.CustomerTextField
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneOffset
import app.cetele.android.core.designsystem.R as CopyR

@OptIn(ExperimentalCoroutinesApi::class)
class CustomerEditViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val customers = mockk<CustomerRepository>()
    private val shops = mockk<ShopRepository>()
    private val clock = Clock.fixed(sampleTime, ZoneOffset.UTC)

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns MutableStateFlow(sampleShop())
    }

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun model(id: String? = null) =
        CustomerEditViewModel(
            SavedStateHandle(mapOf("customerId" to id)),
            customers,
            shops,
            clock,
        )

    @Test
    fun everyCustomerValidatorErrorUsesSpecificCopy() {
        val expected =
            mapOf(
                FieldError("customer.name", FieldCodes.REQUIRED) to CopyR.string.error_field_name_required,
                FieldError("customer.name", FieldCodes.TOO_LONG) to CopyR.string.error_field_name_too_long,
                FieldError("customer.phone", FieldCodes.INVALID_FORMAT) to CopyR.string.error_field_phone_invalid,
                FieldError("customer.note", FieldCodes.TOO_LONG) to CopyR.string.error_field_note_too_long,
                FieldError("customer.tag", FieldCodes.REQUIRED) to CopyR.string.error_field_tag_required,
                FieldError("customer.tag", FieldCodes.TOO_LONG) to CopyR.string.error_field_tag_too_long,
                FieldError("customer.smsConsentAt", FieldCodes.REQUIRED) to
                    CopyR.string.error_field_consent_date_required,
                FieldError("customer.smsConsentSource", FieldCodes.REQUIRED) to
                    CopyR.string.error_field_consent_source_required,
            )
        val invalid =
            CustomerValidator.validate(" ", "bad", "n".repeat(501), "", true, null, null) +
                CustomerValidator.validate("n".repeat(81), null, null, "t".repeat(31), false, null, null)
        assertEquals(expected.keys, invalid.toSet())
        for (error in invalid) {
            assertEquals(expected[error], CustomerEditState(errors = listOf(error)).errorResource(error.field))
        }
    }

    @Test
    fun invalidFieldsDoNotWriteAndConsentNeedsSource() =
        runTest(dispatcher) {
            val model = model()
            advanceUntilIdle()
            model.changeText(CustomerTextField.Name, " ")
            model.changeText(CustomerTextField.Phone, "123")
            model.changeText(CustomerTextField.Note, "n".repeat(501))
            model.changeText(CustomerTextField.Tag, "t".repeat(31))
            model.changeConsent(true)
            model.save()
            assertEquals(
                setOf("customer.name", "customer.phone", "customer.note", "customer.tag", "customer.smsConsentSource"),
                model.state.value.errors
                    .map { it.field }
                    .toSet(),
            )
            coVerify(exactly = 0) { customers.save(any(), any()) }
            assertFalse(model.state.value.saving)
        }

    @Test
    fun saveNormalizesPhoneAndRecordsSelectedConsentDateAndSource() =
        runTest(dispatcher) {
            val draft = slot<CustomerDraft>()
            coEvery { customers.save("shop-one", capture(draft)) } returns WriteResult.Ok("saved-customer")
            val model = model()
            advanceUntilIdle()
            assertEquals(LocalDate.of(2026, 10, 6), model.state.value.consentDate)
            model.changeText(CustomerTextField.Name, "  Örnek müşteri  ")
            model.changeText(CustomerTextField.Phone, "0532 123 45 67")
            model.changeConsent(true)
            model.changeSource(ConsentSource.WRITTEN)
            model.changeDate(LocalDate.of(2026, 10, 5))
            model.save()
            model.save()
            advanceUntilIdle()
            assertEquals("Örnek müşteri", draft.captured.name)
            assertEquals("+905321234567", draft.captured.phone)
            assertEquals(ConsentSource.WRITTEN, draft.captured.smsConsentSource)
            assertEquals("2026-10-04T21:00:00Z", draft.captured.smsConsentAt.toString())
            assertTrue(draft.captured.smsConsent)
            assertEquals("saved-customer", model.state.value.savedId)
            coVerify(exactly = 1) { customers.save(any(), any()) }
        }

    @Test
    fun existingConsentInstantSurvivesUnrelatedEditAndRevocationClearsEvidence() =
        runTest(dispatcher) {
            val existing =
                sampleCustomer().copy(
                    smsConsent = true,
                    smsConsentAt = sampleTime,
                    smsConsentSource = ConsentSource.PHONE,
                )
            every { customers.observe("shop-one", "customer-one") } returns MutableStateFlow<Customer?>(existing)
            val captured = slot<CustomerDraft>()
            coEvery { customers.save("shop-one", capture(captured)) } returns WriteResult.Ok("customer-one")
            val first = model("customer-one")
            advanceUntilIdle()
            first.changeText(CustomerTextField.Note, "Örnek not")
            first.save()
            advanceUntilIdle()
            assertEquals(sampleTime, captured.captured.smsConsentAt)
            assertEquals("customer-one", captured.captured.id)
            val second = model("customer-one")
            advanceUntilIdle()
            second.changeConsent(false)
            second.save()
            advanceUntilIdle()
            assertFalse(captured.captured.smsConsent)
            assertEquals(null, captured.captured.smsConsentAt)
            assertEquals(null, captured.captured.smsConsentSource)
        }

    @Test
    fun repositoryValidationErrorsRemainVisible() =
        runTest(dispatcher) {
            val error = FieldError("customer.tag", FieldCodes.REQUIRED)
            coEvery { customers.save(any(), any()) } returns WriteResult.Invalid(listOf(error))
            val model = model()
            advanceUntilIdle()
            model.changeText(CustomerTextField.Name, "Örnek müşteri")
            model.save()
            advanceUntilIdle()
            assertEquals(listOf(error), model.state.value.errors)
            assertEquals(CopyR.string.error_field_tag_required, model.state.value.errorResource(error.field))
            assertFalse(model.state.value.saving)
            assertEquals(null, model.state.value.savedId)
        }

    @Test
    fun deletedCustomerCannotBeSaved() =
        runTest(dispatcher) {
            every { customers.observe("shop-one", "customer-one") } returns
                MutableStateFlow<Customer?>(sampleCustomer().copy(deletedAt = sampleTime))
            val model = model("customer-one")
            advanceUntilIdle()
            model.save()
            assertFalse(model.state.value.available)
            assertEquals("customer.deleted", model.state.value.problemCode)
            coVerify(exactly = 0) { customers.save(any(), any()) }
        }
}
