package app.cetele.android.feature.reminders

import app.cetele.android.core.data.database.entity.ReminderLogEntity
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.ReminderLogRepository
import app.cetele.android.core.data.repository.ReminderRecord
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.api.RemindersApi
import app.cetele.android.core.network.api.StatementsApi
import app.cetele.android.core.network.dto.reminders.QuotaState
import app.cetele.android.core.network.dto.reminders.ReminderRequest
import app.cetele.android.core.network.dto.reminders.ReminderResponse
import app.cetele.android.core.network.dto.statements.StatementLinkRequest
import app.cetele.android.core.network.dto.statements.StatementLinkResponse
import app.cetele.android.feature.reminders.sheet.ReminderState
import app.cetele.android.feature.reminders.sheet.ReminderViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.ZoneOffset
import app.cetele.android.core.designsystem.R as DesignR

@OptIn(ExperimentalCoroutinesApi::class)
class ReminderViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val customers = mockk<CustomerRepository>()
    private val shops = mockk<ShopRepository>()
    private val logs = mockk<ReminderLogRepository>()
    private val statements = mockk<StatementsApi>()
    private val reminders = mockk<RemindersApi>()
    private val customer = MutableStateFlow(reminderCustomer())
    private val balance = MutableStateFlow(Money(125000))
    private val last = MutableStateFlow<ReminderLogEntity?>(null)

    @BeforeEach
    fun prepare() {
        Dispatchers.setMain(dispatcher)
        every { shops.observeActive() } returns MutableStateFlow(reminderShop())
        every { customers.observe("shop", "customer") } returns customer
        every { customers.observeBalance("shop", "customer") } returns balance
        every { logs.observeLast("shop", "customer") } returns last
        coEvery { logs.record(any(), any(), any()) } returns Unit
    }

    @AfterEach
    fun finish() {
        Dispatchers.resetMain()
    }

    private fun model(clock: Clock = Clock.fixed(reminderTime, ZoneOffset.UTC)): ReminderViewModel =
        ReminderViewModel(
            "customer",
            customers,
            shops,
            logs,
            statements,
            reminders,
            clock,
        )

    @Test
    fun everyDisabledReasonHasCopy() {
        val ready = ReminderState(shop = reminderShop(), customer = reminderCustomer(), balanceMinor = 100)
        assertNull(ready.whatsappDisabledReason)
        assertNull(ready.smsDisabledReason)
        assertEquals(R.string.reminders_sheet_unavailable, ReminderState().smsDisabledReason)
        assertEquals(
            R.string.reminders_sheet_unavailable,
            ready.copy(customer = reminderCustomer().copy(deletedAt = reminderTime)).smsDisabledReason,
        )
        for (phone in listOf(null, "", " ")) {
            val missing = ready.copy(customer = reminderCustomer().copy(phone = phone))
            assertEquals(R.string.reminders_sheet_phone_missing, missing.whatsappDisabledReason)
            assertEquals(R.string.reminders_sheet_phone_missing, missing.smsDisabledReason)
        }
        for (amount in listOf(0L, -1L)) {
            assertEquals(R.string.reminders_sheet_no_balance, ready.copy(balanceMinor = amount).whatsappDisabledReason)
            assertEquals(R.string.reminders_sheet_no_balance, ready.copy(balanceMinor = amount).smsDisabledReason)
        }
        val noConsent = ready.copy(customer = reminderCustomer().copy(smsConsent = false))
        assertNull(noConsent.whatsappDisabledReason)
        assertEquals(R.string.reminders_sheet_consent_missing, noConsent.smsDisabledReason)
        assertEquals(R.string.reminders_sheet_provider_failed, ready.copy(smsUncertain = true).smsDisabledReason)
    }

    @Test
    fun disabledActionsNeverCallServer() =
        runTest(dispatcher) {
            customer.value = customer.value.copy(phone = null)
            val viewModel = model()
            advanceUntilIdle()
            viewModel.sendSms()
            viewModel.sendWhatsApp()
            advanceUntilIdle()
            coVerify(exactly = 0) { reminders.send(any(), any()) }
            coVerify(exactly = 0) { statements.createLink(any(), any()) }
        }

    @Test
    fun smsSuccessShowsQuotaAndRecordsOnlyOnceWhileBusy() =
        runTest(dispatcher) {
            val quota = QuotaState("2026-10", 7, 30)
            coEvery { reminders.send("shop", ReminderRequest("customer", "SMS", "BALANCE")) } returns
                ApiResult.Success(ReminderResponse("reminder", "SENT", reminderTime, quota = quota), 201)
            val viewModel = model()
            advanceUntilIdle()
            viewModel.sendSms()
            viewModel.sendSms()
            advanceUntilIdle()
            assertEquals(quota, viewModel.state.value.quota)
            assertEquals(R.string.reminders_sheet_sms_sent, viewModel.state.value.message)
            assertFalse(viewModel.state.value.busy)
            coVerify(exactly = 1) { reminders.send("shop", ReminderRequest("customer")) }
            coVerify(
                exactly = 1,
            ) { logs.record("shop", "customer", ReminderRecord("SMS", reminderTime, "SENT", 7, 30)) }
        }

    @Test
    fun serverCodesMapToSharedCopyAndRetryAfterPreventsRepeat() =
        runTest(dispatcher) {
            val codes =
                mapOf(
                    "sms.phone_missing" to DesignR.string.error_sms_phone_missing,
                    "sms.consent_missing" to DesignR.string.error_sms_consent_missing,
                    "reminder.no_balance" to DesignR.string.error_reminder_no_balance,
                    "sms.quota_exceeded" to DesignR.string.error_sms_quota_exceeded,
                    "sms.daily_cap_reached" to DesignR.string.error_sms_daily_cap_reached,
                    "rate_limited" to DesignR.string.error_rate_limited,
                    "forbidden" to DesignR.string.error_forbidden,
                    "not_found" to DesignR.string.error_not_found,
                    "validation.failed" to DesignR.string.error_validation_failed,
                )
            for ((code, resource) in codes) {
                coEvery { reminders.send(any(), any()) } returns
                    ApiResult.Failure.Problem(
                        ProblemDetail(title = "Error", status = 429, code = code, traceId = "support"),
                        60,
                    )
                val viewModel = model()
                advanceUntilIdle()
                viewModel.sendSms()
                advanceUntilIdle()
                assertEquals(resource, viewModel.state.value.message)
                assertEquals(60, viewModel.state.value.retrySeconds)
                assertEquals(reminderTime.toEpochMilli() + 60000, viewModel.state.value.retryAtMillis)
                assertEquals("support", viewModel.state.value.traceId)
                viewModel.sendSms()
                advanceUntilIdle()
            }
            coVerify(exactly = codes.size) { reminders.send(any(), any()) }
            coVerify(exactly = 0) { logs.record(any(), any(), any()) }
        }

    @Test
    fun ambiguousProviderFailureIsNeverRetried() =
        runTest(dispatcher) {
            for (failure in listOf(
                ApiResult.Failure.Problem(ProblemDetail(title = "Error", status = 502, code = "sms.provider_failed")),
                ApiResult.Failure.Unexpected(502),
            )) {
                coEvery { reminders.send(any(), any()) } returns failure
                val viewModel = model()
                advanceUntilIdle()
                viewModel.sendSms()
                advanceUntilIdle()
                assertEquals(R.string.reminders_sheet_provider_failed, viewModel.state.value.message)
                assertTrue(viewModel.state.value.smsUncertain)
                viewModel.sendSms()
                advanceUntilIdle()
            }
            coVerify(exactly = 2) { reminders.send(any(), any()) }
            coVerify(exactly = 0) { logs.record(any(), any(), any()) }
        }

    @Test
    fun statementLimitAndUnknownErrorsHaveSafeCopy() =
        runTest(dispatcher) {
            for (code in listOf("statement.link_limit", "unknown.code")) {
                coEvery { statements.createLink(any(), any()) } returns
                    ApiResult.Failure.Problem(
                        ProblemDetail(title = "Error", status = 409, code = code),
                    )
                val viewModel = model()
                advanceUntilIdle()
                viewModel.sendWhatsApp()
                advanceUntilIdle()
                assertEquals(ProblemCodeText.resIdOrGeneric(code), viewModel.state.value.message)
                assertFalse(viewModel.state.value.busy)
            }
            coVerify(exactly = 0) { logs.record(any(), any(), any()) }
        }

    @Test
    fun whatsappUsesStatementUrlAndLogsAfterOpeningOnly() =
        runTest(dispatcher) {
            coEvery { statements.createLink("shop", StatementLinkRequest("customer")) } returns
                ApiResult.Success(
                    StatementLinkResponse("link", "https://cetele.app/s/example", "sample-" + "value", reminderTime),
                    201,
                )
            val viewModel = model()
            advanceUntilIdle()
            viewModel.sendWhatsApp()
            advanceUntilIdle()
            assertEquals(
                ReminderTemplates.whatsapp("Ayşe", "Köşe Bakkalı", 125000, "https://cetele.app/s/example"),
                viewModel.shareRequests.first(),
            )
            coVerify(exactly = 0) { logs.record(any(), any(), any()) }
            viewModel.shareFinished(true)
            advanceUntilIdle()
            coVerify(
                exactly = 1,
            ) { logs.record("shop", "customer", ReminderRecord("WHATSAPP", reminderTime, "SHARED")) }
            assertFalse(viewModel.state.value.busy)
            last.value = ReminderLogEntity("log", "shop", "customer", "WHATSAPP", reminderTime.toString(), "SHARED")
            advanceUntilIdle()
            assertEquals(last.value, viewModel.state.value.lastReminder)
        }

    @Test
    fun failedShareDoesNotRecordDelivery() =
        runTest(dispatcher) {
            coEvery { statements.createLink(any(), any()) } returns
                ApiResult.Success(
                    StatementLinkResponse("link", "https://cetele.app/s/example", "sample-" + "value", reminderTime),
                    201,
                )
            val viewModel = model()
            advanceUntilIdle()
            viewModel.sendWhatsApp()
            advanceUntilIdle()
            viewModel.shareFinished(false)
            advanceUntilIdle()
            assertEquals(R.string.reminders_sheet_share_failed, viewModel.state.value.message)
            coVerify(exactly = 0) { logs.record(any(), any(), any()) }
        }

    @Test
    fun retryAfterAllowsANewRequestOnlyAfterTheDeadline() =
        runTest(dispatcher) {
            var now = reminderTime.toEpochMilli()
            val clock = mockk<Clock>()
            every { clock.millis() } answers { now }
            coEvery { reminders.send(any(), any()) } returns
                ApiResult.Failure.Problem(
                    ProblemDetail(title = "Error", status = 429, code = "rate_limited"),
                    60,
                )
            val viewModel = model(clock)
            advanceUntilIdle()
            viewModel.sendSms()
            advanceUntilIdle()
            now += 59999
            viewModel.sendSms()
            advanceUntilIdle()
            coVerify(exactly = 1) { reminders.send(any(), any()) }
            now += 1
            viewModel.sendSms()
            advanceUntilIdle()
            coVerify(exactly = 2) { reminders.send(any(), any()) }
        }

    @Test
    fun transportFailureShowsGenericCopyWithoutAnAutomaticRetry() =
        runTest(dispatcher) {
            coEvery { reminders.send(any(), any()) } returns ApiResult.Failure.Network(java.io.IOException())
            val viewModel = model()
            advanceUntilIdle()
            viewModel.sendSms()
            advanceUntilIdle()
            assertEquals(DesignR.string.error_generic, viewModel.state.value.message)
            assertFalse(viewModel.state.value.busy)
            coVerify(exactly = 1) { reminders.send(any(), any()) }
            coVerify(exactly = 0) { logs.record(any(), any(), any()) }
        }
}
