package app.cetele.android.feature.auth

import android.app.Application
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.SavedStateHandle
import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.lock.PinStore
import app.cetele.android.core.data.session.DeviceIdentity
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.network.ApiConfig
import app.cetele.android.core.network.HttpClientFactory
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.KtorAuthApi
import app.cetele.android.core.network.auth.AccessTokenHolder
import app.cetele.android.core.network.auth.TokenRefresher
import app.cetele.android.core.network.dto.auth.OtpRequestBody
import app.cetele.android.core.network.dto.auth.OtpVerifyBody
import app.cetele.android.core.network.dto.auth.SignInResponse
import app.cetele.android.core.network.dto.auth.UserSummary
import app.cetele.android.core.network.integrity.FakeIntegrityTokenProvider
import app.cetele.android.core.network.pinning.CertificatePins
import app.cetele.android.feature.auth.common.OtpRequester
import app.cetele.android.feature.auth.otp.OtpDestination
import app.cetele.android.feature.auth.otp.OtpScreen
import app.cetele.android.feature.auth.otp.OtpViewModel
import app.cetele.android.feature.auth.phone.PhoneScreen
import app.cetele.android.feature.auth.phone.PhoneViewModel
import app.cetele.android.feature.auth.pinsetup.PinSetupScreen
import app.cetele.android.feature.auth.pinsetup.PinSetupViewModel
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class, qualifiers = "tr")
class SignInFlowTest {
    @get:Rule val compose = createComposeRule()

    private val phoneNumber = "+905321234567"
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()
    private val response =
        SignInResponse(
            UUID.randomUUID().toString(),
            900,
            UUID.randomUUID().toString(),
            UserSummary(UUID.randomUUID().toString()),
            true,
        )
    private val config = ApiConfig("https://api.cetele.app", "0.3.0")
    private val identity = mockk<DeviceIdentity>()
    private val session = mockk<SessionManager>(relaxed = true)
    private val lock = mockk<LockController>(relaxed = true)
    private val pins = mockk<PinStore>()
    private val settings = mockk<SettingsRepository>()
    private var stored = UserSettings()
    private var pinSize = 0

    private val engine =
        MockEngine { request ->
            requests += request.url.encodedPath to (request.body as TextContent).text
            when (request.url.encodedPath) {
                "/v1/auth/otp/request" -> {
                    respond("", HttpStatusCode.Accepted)
                }

                "/v1/auth/otp/verify" -> {
                    val json = NetworkJson.encodeToString(SignInResponse.serializer(), response)
                    respond(json, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                }

                else -> {
                    error("Unexpected request path")
                }
            }
        }

    @Test
    fun phoneCodeAndMatchingPinCompleteTheFlowAgainstTheHttpContract() {
        coEvery { identity.id() } returns "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
        coEvery { settings.current() } answers { stored }
        coEvery { settings.update(any()) } answers {
            firstArg<(UserSettings) -> UserSettings>().invoke(stored).also { stored = it }
        }
        every { pins.set(any()) } answers { pinSize = firstArg<CharArray>().size }
        val client =
            HttpClientFactory.createApiClient(
                config,
                CertificatePins(false),
                AccessTokenHolder(),
                mockk<TokenRefresher>(),
                engine,
            )
        client.use {
            val api = KtorAuthApi(it)
            val requester =
                OtpRequester(api, identity, FakeIntegrityTokenProvider(listOf("fake", "ok").joinToString(".")))
            val phone = PhoneViewModel(requester)
            val setup = PinSetupViewModel(pins, settings, lock)
            compose.setContent { CeteleTheme { SignInFlow(phone, setup, api, requester) } }

            compose.onNodeWithText("Telefon numaranız").performTextInput("05321234567")
            compose.onNodeWithText("Kod gönder").performClick()
            awaitMain { phone.state.value.requestedPhone != null }
            compose.onNodeWithContentDescription("6 haneli doğrulama kodu").performTextInput("123456")
            awaitMain { compose.onAllNodesWithText("PIN oluşturun").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("PIN oluşturun").assertIsDisplayed()
            "123456".forEach { digit -> compose.onNodeWithContentDescription(digit.toString()).performClick() }
            compose.onNodeWithText("PIN’inizi tekrar girin").assertIsDisplayed()
            "123456".forEach { digit -> compose.onNodeWithContentDescription(digit.toString()).performClick() }
            awaitMain { setup.state.value.complete }
        }
        assertContract()
    }

    @Composable
    private fun SignInFlow(
        phone: PhoneViewModel,
        setup: PinSetupViewModel,
        api: AuthApi,
        requester: OtpRequester,
    ) {
        var screen by remember { mutableIntStateOf(PHONE) }
        val phoneState by phone.state.collectAsState()
        val setupState by setup.state.collectAsState()
        val requested = phoneState.requestedPhone
        val otp =
            remember(requested) {
                requested?.let {
                    OtpViewModel(
                        SavedStateHandle(mapOf("phone" to it)),
                        api,
                        identity,
                        session,
                        settings,
                        requester,
                        config,
                    )
                }
            }
        LaunchedEffect(requested) { if (requested != null) screen = OTP }
        when (screen) {
            PHONE -> {
                PhoneScreen(phoneState, phone::edit, phone::send)
            }

            OTP -> {
                val model = checkNotNull(otp)
                val otpState by model.state.collectAsState()
                LaunchedEffect(otpState.destination) {
                    if (otpState.destination ==
                        OtpDestination.PinSetup
                    ) {
                        screen = PIN
                    }
                }
                OtpScreen(otpState, { model.submit(it, "test-device") }, model::resend, { screen = PHONE })
            }

            else -> {
                PinSetupScreen(setupState, setup::enter, setup::enableBiometric)
            }
        }
    }

    /** View models resume on the Android main looper; idle it so their results land while the test waits. */
    private fun awaitMain(condition: () -> Boolean) {
        compose.waitUntil(TIMEOUT_MILLIS) {
            shadowOf(Looper.getMainLooper()).idle()
            condition()
        }
    }

    private fun assertContract() {
        assertTrue(stored.pinSetupDone)
        assertEquals(6, pinSize)
        assertEquals(2, requests.size)
        val requested = NetworkJson.decodeFromString(OtpRequestBody.serializer(), requests[0].second)
        val verified = NetworkJson.decodeFromString(OtpVerifyBody.serializer(), requests[1].second)
        assertEquals(phoneNumber, requested.phone)
        assertTrue(requested.integrityToken?.isNotBlank() == true)
        assertEquals(requested.deviceId, verified.deviceId)
        assertEquals("123456", verified.code)
        assertEquals("0.3.0", verified.appVersion)
        coVerify(exactly = 1) { session.signIn(response, phoneNumber) }
        verify(exactly = 1) { lock.unlock() }
    }

    private companion object {
        const val PHONE = 0
        const val OTP = 1
        const val PIN = 2
        const val TIMEOUT_MILLIS = 5_000L
    }
}
