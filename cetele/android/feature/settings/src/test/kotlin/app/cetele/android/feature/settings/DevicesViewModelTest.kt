package app.cetele.android.feature.settings

import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.DeviceSession
import app.cetele.android.core.network.api.DeviceSignOutBody
import app.cetele.android.core.network.api.DevicesApi
import app.cetele.android.core.network.api.ReauthAction
import app.cetele.android.feature.settings.devices.DevicesViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DevicesViewModelTest : SettingsTestSupport() {
    private val api = mockk<DevicesApi>()
    private val auth = mockk<AuthApi>()
    private val session = mockk<SessionManager>()
    private val current = DeviceSession("row-current", "Phone", "1.0", "2026-10-11T12:00:00Z", true, true)
    private val other = current.copy(id = "row-other", current = false)
    private val ended = other.copy(id = "row-ended", signedIn = false)
    private val code = "123456"

    private suspend fun loaded(): DevicesViewModel {
        coEvery { api.list() } returns ApiResult.Success(listOf(current, other, ended), 200)
        coEvery { auth.requestReauth(ReauthAction.DEVICE_SIGN_OUT) } returns ApiResult.Success(Unit, 202)
        return DevicesViewModel(api, auth, session).also { it.load().join() }
    }

    @Test fun otherDeviceNeedsScopedCodeAndRefreshesAfterSignOut() =
        runTest(dispatcher) {
            val model = loaded()
            assertEquals(listOf(current, other, ended), model.state.value.devices)
            model.select(other.id)
            model.signOut(code).join()
            coVerify(exactly = 0) { api.signOut(any(), any()) }
            model.requestCode().join()
            coEvery { api.signOut(other.id, DeviceSignOutBody(code)) } returns ApiResult.Success(Unit, 204)
            coEvery { api.list() } returns ApiResult.Success(listOf(current, other.copy(signedIn = false)), 200)
            model.signOut(code).join()
            assertFalse(
                model.state.value.devices
                    .last()
                    .signedIn,
            )
            assertFalse(model.state.value.codeSent)
            assertEquals(null, model.state.value.selectedId)
            coVerify(exactly = 1) { auth.requestReauth(ReauthAction.DEVICE_SIGN_OUT) }
            coVerify(exactly = 0) { session.signOut(any()) }
        }

    @Test fun currentDeviceSignOutClearsLocalSession() =
        runTest(dispatcher) {
            val model = loaded()
            model.select(current.id)
            model.requestCode().join()
            coEvery { api.signOut(current.id, DeviceSignOutBody(code)) } returns ApiResult.Success(Unit, 204)
            coEvery { session.signOut(SignOutReason.USER) } returns Unit
            model.signOut(code).join()
            coVerify(exactly = 1) { session.signOut(SignOutReason.USER) }
            coVerify(exactly = 1) { api.list() }
        }

    @Test fun invalidCodeAndUnknownDeviceNeverSignOutLocally() =
        runTest(dispatcher) {
            val model = loaded()
            model.select(ended.id)
            model.select("unknown")
            model.requestCode().join()
            coVerify(exactly = 0) { auth.requestReauth(any(), any()) }
            model.select(other.id)
            model.requestCode().join()
            model.signOut("bad").join()
            assertEquals(
                "auth.reauth_invalid",
                model.state.value.error
                    ?.code,
            )
            coVerify(exactly = 0) { api.signOut(any(), any()) }
            for (reason in listOf("auth.reauth_invalid", "not_found")) {
                coEvery { api.signOut(other.id, DeviceSignOutBody(code)) } returns problem(reason)
                model.signOut(code).join()
                assertEquals(
                    reason,
                    model.state.value.error
                        ?.code,
                )
                assertEquals(listOf(current, other, ended), model.state.value.devices)
            }
            coVerify(exactly = 0) { session.signOut(any()) }
        }

    @Test fun failedListAndCodeRequestRemainRetryable() =
        runTest(dispatcher) {
            coEvery { api.list() } returns ApiResult.Failure.Network(java.io.IOException("offline"))
            val model = DevicesViewModel(api, auth, session)
            model.load().join()
            assertTrue(model.state.value.error != null)
            assertFalse(model.state.value.busy)
            coEvery { api.list() } returns ApiResult.Success(listOf(other), 200)
            model.load().join()
            model.select(other.id)
            coEvery { auth.requestReauth(ReauthAction.DEVICE_SIGN_OUT) } returns problem("rate_limited", 40)
            model.requestCode().join()
            assertFalse(model.state.value.codeSent)
            assertEquals(
                40,
                model.state.value.error
                    ?.retryAfterSeconds,
            )
            model.signOut(code).join()
            coVerify(exactly = 0) { api.signOut(any(), any()) }
            coEvery { auth.requestReauth(ReauthAction.DEVICE_SIGN_OUT) } returns ApiResult.Success(Unit, 202)
            model.requestCode().join()
            assertTrue(model.state.value.codeSent)
            model.select(other.id)
            assertFalse(model.state.value.codeSent)
        }
}
