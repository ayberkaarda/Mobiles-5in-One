package app.cetele.android.feature.auth

import androidx.lifecycle.SavedStateHandle
import app.cetele.android.core.data.session.DeviceIdentity
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.network.ApiConfig
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.dto.auth.OtpVerifyBody
import app.cetele.android.core.network.dto.auth.SignInResponse
import app.cetele.android.core.network.dto.auth.UserSummary
import app.cetele.android.core.network.integrity.IntegrityResult
import app.cetele.android.core.network.integrity.IntegrityTokenProvider
import app.cetele.android.feature.auth.common.OtpRequester
import app.cetele.android.feature.auth.otp.OtpDestination
import app.cetele.android.feature.auth.otp.OtpViewModel
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
import java.util.UUID

@OptIn(ExperimentalCoroutinesApi::class)
class OtpViewModelTest : MainDispatcherTest() {
    private val api = mockk<AuthApi>()
    private val identity = mockk<DeviceIdentity>()
    private val integrity = mockk<IntegrityTokenProvider>()
    private val session = mockk<SessionManager>(relaxed = true)
    private val settings = mockk<SettingsRepository>()
    private val phone = "+905321234567"
    private val deviceId = "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
    private val response =
        SignInResponse(
            UUID.randomUUID().toString(),
            900,
            UUID.randomUUID().toString(),
            UserSummary(UUID.randomUUID().toString()),
            true,
        )

    private fun model(pinDone: Boolean = false): OtpViewModel {
        coEvery { identity.id() } returns deviceId
        coEvery { integrity.token(any()) } returns IntegrityResult.Token(listOf("fake", "ok").joinToString("."))
        coEvery { settings.current() } returns UserSettings(pinSetupDone = pinDone)
        return OtpViewModel(
            SavedStateHandle(mapOf("phone" to phone)),
            api,
            identity,
            session,
            settings,
            OtpRequester(api, identity, integrity),
            ApiConfig("https://api.cetele.app", "v".repeat(40)),
        )
    }

    @Test
    fun sixDigitsSignInWithClippedDeviceMetadataAndRequirePinSetup() =
        runTest(dispatcher) {
            val body = slot<OtpVerifyBody>()
            coEvery { api.verifyOtp(capture(body)) } returns ApiResult.Success(response, 200)
            val model = model()
            model.submit("123456", "m".repeat(150))
            model.submit("123456", "duplicate")
            runCurrent()
            assertEquals(phone, body.captured.phone)
            assertEquals(deviceId, body.captured.deviceId)
            assertEquals("123456", body.captured.code)
            assertEquals(100, body.captured.model.length)
            assertEquals(32, body.captured.appVersion.length)
            coVerify(exactly = 1) { session.signIn(response, phone) }
            coVerify(exactly = 1) { api.verifyOtp(any()) }
            assertEquals(OtpDestination.PinSetup, model.state.value.destination)
        }

    @Test
    fun anExistingPinSetupReturnsControlToTheApp() =
        runTest(dispatcher) {
            coEvery { api.verifyOtp(any()) } returns ApiResult.Success(response, 200)
            val model = model(pinDone = true)
            model.submit("123456", "device")
            runCurrent()
            assertEquals(OtpDestination.SignedIn, model.state.value.destination)
        }

    @Test
    fun malformedAndRejectedCodesNeverStartASession() =
        runTest(dispatcher) {
            val model = model()
            for (code in listOf("12345", "abcdef", "1234567")) model.submit(code, "device")
            coVerify(exactly = 0) { api.verifyOtp(any()) }
            coEvery { api.verifyOtp(any()) } returns
                ApiResult.Failure.Problem(ProblemDetail(title = "Invalid", status = 401, code = "auth.otp_invalid"))
            model.submit("123456", "device")
            runCurrent()
            assertEquals(
                R.string.auth_otp_invalid,
                model.state.value.error
                    ?.resource,
            )
            assertEquals(1, model.state.value.attempt)
            assertFalse(model.state.value.loading)
            assertNull(model.state.value.destination)
            coVerify(exactly = 0) { session.signIn(any(), any()) }
        }

    @Test
    fun resendWaitsSixtySecondsAndRequestsFreshIntegrity() =
        runTest(dispatcher) {
            coEvery { api.requestOtp(any()) } returns ApiResult.Success(Unit, 202)
            val model = model()
            runCurrent()
            model.resend()
            coVerify(exactly = 0) { api.requestOtp(any()) }
            advanceTimeBy(59_000)
            runCurrent()
            assertEquals(1, model.state.value.resendSeconds)
            advanceTimeBy(1000)
            runCurrent()
            model.resend()
            runCurrent()
            coVerify(exactly = 1) { integrity.token(any()) }
            coVerify(exactly = 1) {
                api.requestOtp(
                    match {
                        it.phone == phone && it.deviceId == deviceId &&
                            it.integrityToken != null
                    },
                )
            }
            assertEquals(60, model.state.value.resendSeconds)
            assertEquals(1, model.state.value.attempt)
        }

    @Test
    fun resendRateLimitUsesRetryAfterAndUnavailableIntegritySendsNothing() =
        runTest(dispatcher) {
            val model = model()
            runCurrent()
            advanceTimeBy(60_000)
            runCurrent()
            coEvery { api.requestOtp(any()) } returns
                ApiResult.Failure.Problem(ProblemDetail(title = "Limit", status = 429, code = "rate_limited"), 23)
            model.resend()
            runCurrent()
            assertEquals(23, model.state.value.resendSeconds)
            advanceTimeBy(23_000)
            runCurrent()
            coEvery { integrity.token(any()) } returns IntegrityResult.Unavailable("offline")
            model.resend()
            runCurrent()
            assertEquals(
                R.string.auth_phone_integrity_unavailable,
                model.state.value.error
                    ?.resource,
            )
            coVerify(exactly = 1) { api.requestOtp(any()) }
            coVerify(exactly = 0) { session.signIn(any(), any()) }
        }

    @Test
    fun verificationRateLimitBlocksFurtherAttemptsUntilTheServerDelayEnds() =
        runTest(dispatcher) {
            val model = model()
            coEvery { api.verifyOtp(any()) } returns
                ApiResult.Failure.Problem(ProblemDetail(title = "Limit", status = 429, code = "rate_limited"), 12)
            model.submit("123456", "device")
            runCurrent()
            assertEquals(12, model.state.value.retrySeconds)
            model.submit("654321", "device")
            coVerify(exactly = 1) { api.verifyOtp(any()) }
            advanceTimeBy(12_000)
            runCurrent()
            assertEquals(0, model.state.value.retrySeconds)
            coEvery { api.verifyOtp(any()) } returns ApiResult.Success(response, 200)
            model.submit("654321", "device")
            runCurrent()
            assertEquals(OtpDestination.PinSetup, model.state.value.destination)
        }
}
