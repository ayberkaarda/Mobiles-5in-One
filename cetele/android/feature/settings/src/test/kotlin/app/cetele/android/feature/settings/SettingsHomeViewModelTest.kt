package app.cetele.android.feature.settings

import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.session.SignOutCheck
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.MeApi
import app.cetele.android.core.network.dto.me.DeletionStatus
import app.cetele.android.feature.settings.home.SettingsHomeViewModel
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsHomeViewModelTest : SettingsTestSupport() {
    private val shops = mockk<ShopRepository>()
    private val settings = mockk<SettingsRepository>()
    private val me = mockk<MeApi>()
    private val session = mockk<SessionManager>()
    private val databases = mockk<DatabaseStore>()
    private val deletion =
        MutableStateFlow<DeletionStatus?>(DeletionStatus(Instant.EPOCH, Instant.EPOCH.plusSeconds(1209600), true))

    private fun model(): SettingsHomeViewModel {
        every { shops.observeActive() } returns MutableStateFlow<Shop?>(null)
        every { shops.deletion } returns deletion
        every { settings.settings } returns MutableStateFlow(UserSettings())
        return SettingsHomeViewModel(shops, settings, me, session, databases)
    }

    @Test
    fun cancelDeletionClearsBlockedGraceAndRefreshesMemberships() =
        runTest(dispatcher) {
            coEvery { me.cancelDeletion() } returns ApiResult.Success(Unit, 204)
            coEvery { shops.refresh() } coAnswers {
                deletion.value = null
                ApiResult.Success(Unit, 200)
            }
            val model = model()
            runCurrent()
            assertTrue(
                model.state.value.deletion
                    ?.blocked == true,
            )
            model.cancelDeletion().join()
            runCurrent()
            assertEquals(null, model.state.value.deletion)
            assertFalse(model.state.value.busy)
            coVerify(exactly = 1) { shops.refresh() }
            coVerify(exactly = 0) { session.signOut(any()) }
        }

    @Test
    fun failedCancellationKeepsGraceVisible() =
        runTest(dispatcher) {
            coEvery { me.cancelDeletion() } returns problem("rate_limited", 20)
            val model = model()
            runCurrent()
            model.cancelDeletion().join()
            assertEquals(deletion.value, model.state.value.deletion)
            assertEquals(
                20,
                model.state.value.error
                    ?.retryAfterSeconds,
            )
            coVerify(exactly = 0) { shops.refresh() }
        }

    @Test
    fun unsentRecordsRequireASecondConfirmationAndCountChangesRequireAnother() =
        runTest(dispatcher) {
            var count = 2
            coEvery { session.checkSignOut() } coAnswers { SignOutCheck.Pending(count) }
            coEvery { session.signOut(SignOutReason.USER) } returns Unit
            val model = model()
            model.confirmSignOut().join()
            coVerify(exactly = 0) { session.checkSignOut() }
            model.requestSignOut()
            model.confirmSignOut().join()
            assertEquals(2, model.state.value.signOutPending)
            coVerify(exactly = 0) { session.signOut(any()) }
            count = 3
            model.confirmSignOut().join()
            assertEquals(3, model.state.value.signOutPending)
            coVerify(exactly = 0) { session.signOut(any()) }
            model.confirmSignOut().join()
            coVerify(exactly = 1) { session.signOut(SignOutReason.USER) }
            model.dismissSignOut()
            assertFalse(model.state.value.signOutConfirmation)
            assertEquals(null, model.state.value.signOutPending)
        }
}
