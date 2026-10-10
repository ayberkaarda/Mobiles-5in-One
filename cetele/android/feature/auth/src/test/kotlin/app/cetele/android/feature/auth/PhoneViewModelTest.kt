package app.cetele.android.feature.auth

import app.cetele.android.core.data.session.DeviceIdentity
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.dto.auth.OtpRequestBody
import app.cetele.android.core.network.integrity.IntegrityNonce
import app.cetele.android.core.network.integrity.IntegrityResult
import app.cetele.android.core.network.integrity.IntegrityTokenProvider
import app.cetele.android.feature.auth.common.OtpRequester
import app.cetele.android.feature.auth.phone.PhoneViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PhoneViewModelTest : MainDispatcherTest() {
    private val api = mockk<AuthApi>()
    private val identity = mockk<DeviceIdentity>()
    private val integrity = mockk<IntegrityTokenProvider>()
    private val deviceId = "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"

    private fun model(): PhoneViewModel {
        coEvery { identity.id() } returns deviceId
        coEvery { integrity.token(any()) } returns IntegrityResult.Token(listOf("fake", "ok").joinToString("."))
        return PhoneViewModel(OtpRequester(api, identity, integrity))
    }

    @Test
    fun validNationalNumberIsNormalizedAndNonceIsBoundToTheDevice() =
        runTest(dispatcher) {
            val body = slot<OtpRequestBody>()
            coEvery { api.requestOtp(capture(body)) } returns ApiResult.Success(Unit, 202)
            val model = model()
            model.edit("0532 123-45-67")
            model.send()
            model.send()
            runCurrent()
            assertEquals("+905321234567", body.captured.phone)
            assertEquals(deviceId, body.captured.deviceId)
            assertEquals("+905321234567", model.state.value.requestedPhone)
            coVerify(exactly = 1) { integrity.token(IntegrityNonce.of(body.captured.phone, deviceId)) }
            coVerify(exactly = 1) { api.requestOtp(any()) }
            model.navigationHandled()
            assertNull(model.state.value.requestedPhone)
        }

    @Test
    fun invalidPhoneNeverRequestsIntegrityOrSms() =
        runTest(dispatcher) {
            val model = model()
            for (phone in listOf("", "02121234567", "53212", "+15551234567")) {
                model.edit(phone)
                model.send()
                assertEquals(
                    R.string.auth_phone_invalid,
                    model.state.value.error
                        ?.resource,
                )
            }
            coVerify(exactly = 0) { integrity.token(any()) }
            coVerify(exactly = 0) { api.requestOtp(any()) }
        }

    @Test
    fun unavailableOrEmptyIntegrityNeverSendsAnUnprotectedRequest() =
        runTest(dispatcher) {
            val model = model()
            model.edit("5321234567")
            for (verdict in listOf(IntegrityResult.Unavailable("offline"), IntegrityResult.Token(""))) {
                coEvery { integrity.token(any()) } returns verdict
                model.send()
                runCurrent()
                assertEquals(
                    R.string.auth_phone_integrity_unavailable,
                    model.state.value.error
                        ?.resource,
                )
                assertFalse(model.state.value.loading)
            }
            coVerify(exactly = 0) { api.requestOtp(any()) }
        }

    @Test
    fun forbiddenIntegrityProblemKeepsTheServerCode() =
        runTest(dispatcher) {
            val model = model()
            coEvery { api.requestOtp(any()) } returns
                ApiResult.Failure.Problem(
                    ProblemDetail(title = "Forbidden", status = 403, code = "auth.integrity_invalid"),
                )
            model.edit("05321234567")
            model.send()
            runCurrent()
            assertEquals(
                "auth.integrity_invalid",
                model.state.value.error
                    ?.code,
            )
            assertEquals(0, model.state.value.retrySeconds)
            assertNull(model.state.value.requestedPhone)
        }

    @Test
    fun rateLimitCountsDownAndBlocksRequestsUntilRetryAfter() =
        runTest(dispatcher) {
            val model = model()
            coEvery { api.requestOtp(any()) } returns
                ApiResult.Failure.Problem(ProblemDetail(title = "Limit", status = 429, code = "rate_limited"), 17)
            model.edit("05321234567")
            model.send()
            runCurrent()
            assertEquals(17, model.state.value.retrySeconds)
            model.send()
            coVerify(exactly = 1) { api.requestOtp(any()) }
            advanceTimeBy(16_000)
            runCurrent()
            assertEquals(1, model.state.value.retrySeconds)
            advanceTimeBy(1000)
            runCurrent()
            assertEquals(0, model.state.value.retrySeconds)
            coEvery { api.requestOtp(any()) } returns ApiResult.Success(Unit, 202)
            model.send()
            runCurrent()
            assertEquals("+905321234567", model.state.value.requestedPhone)
        }

    @Test
    fun unknownProblemRetainsSupportCodeAndNetworkFailureUsesLocalCopy() =
        runTest(dispatcher) {
            val model = model()
            model.edit("05321234567")
            coEvery { api.requestOtp(any()) } returns
                ApiResult.Failure.Problem(
                    ProblemDetail(title = "Error", status = 500, code = "unknown.code", traceId = "support-1"),
                )
            model.send()
            runCurrent()
            assertEquals(
                "support-1",
                model.state.value.error
                    ?.traceId,
            )
            coEvery { api.requestOtp(any()) } returns ApiResult.Failure.Network(java.io.IOException("offline"))
            model.send()
            runCurrent()
            assertEquals(
                R.string.auth_common_connection_error,
                model.state.value.error
                    ?.resource,
            )
        }
}
