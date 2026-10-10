package app.cetele.android.feature.settings

import app.cetele.android.core.data.repository.PhotoUploadState
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.repository.SyncIssue
import app.cetele.android.core.data.repository.SyncIssueRepository
import app.cetele.android.core.data.repository.SyncIssueState
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.feature.settings.sync.SyncIssuesViewModel
import app.cetele.android.feature.settings.sync.reasonText
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SyncIssuesViewModelTest : SettingsTestSupport() {
    private fun issue(
        state: SyncIssueState,
        photo: PhotoUploadState? = null,
        code: String? = null,
    ) = SyncIssue(
        "shop",
        "client",
        SyncKind.ENTRY_CREATE,
        "entry",
        state,
        code,
        photo,
        "2026-10-06T00:00:00Z",
    )

    @Test
    fun onlyRejectedIssuesCanBeDismissedAndFailedPhotosCanBeReleased() =
        runTest(dispatcher) {
            val shops = mockk<ShopRepository>()
            val repository = mockk<SyncIssueRepository>()
            val rows = MutableStateFlow(listOf(issue(SyncIssueState.REJECTED, code = "forbidden")))
            every { shops.observeActive() } returns MutableStateFlow(shop())
            every { repository.observeIssues("shop") } returns rows
            coEvery { repository.dismiss(any(), any()) } returns true
            coEvery { repository.sendWithoutPhoto(any(), any()) } returns true
            val model = SyncIssuesViewModel(shops, repository)
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.issues.collect {} }
            runCurrent()
            assertEquals(rows.value, model.issues.value)
            model.withoutPhoto(rows.value.single()).join()
            model.remove(rows.value.single()).join()
            rows.value = listOf(issue(SyncIssueState.BLOCKED, PhotoUploadState.Uploading))
            runCurrent()
            model.remove(rows.value.single()).join()
            model.withoutPhoto(rows.value.single()).join()
            rows.value =
                listOf(issue(SyncIssueState.BLOCKED, PhotoUploadState.Failed("media.invalid"), "media.invalid"))
            runCurrent()
            model.withoutPhoto(rows.value.single()).join()
            coVerify(exactly = 1) { repository.dismiss("shop", "client") }
            coVerify(exactly = 1) { repository.sendWithoutPhoto(any(), any()) }
            coVerify(exactly = 1) { repository.sendWithoutPhoto("shop", "entry") }
            model.remove(issue(SyncIssueState.REJECTED).copy(shopId = "other")).join()
            coVerify(exactly = 0) { repository.dismiss("other", any()) }
        }

    @Test
    fun reasonsExplainPhotoWaitsFailuresAndServerCodes() {
        val failed = issue(SyncIssueState.BLOCKED, PhotoUploadState.Failed(null))
        assertTrue(failed.canSendWithoutPhoto)
        assertEquals(R.string.settings_sync_photo_failed, reasonText(failed))
        val lost = issue(SyncIssueState.BLOCKED, PhotoUploadState.Absent)
        assertTrue(lost.canSendWithoutPhoto)
        assertEquals(R.string.settings_sync_photo_failed, reasonText(lost))
        val waiting = issue(SyncIssueState.BLOCKED, PhotoUploadState.Uploading)
        assertFalse(waiting.canSendWithoutPhoto)
        assertEquals(R.string.settings_sync_photo_wait, reasonText(waiting))
        val limit = issue(SyncIssueState.BLOCKED, PhotoUploadState.Failed("plan.photo_limit"), "plan.photo_limit")
        assertEquals(ProblemCodeText.resId("plan.photo_limit"), reasonText(limit))
        val validation = issue(SyncIssueState.BLOCKED, code = "validation.failed")
        assertFalse(validation.canSendWithoutPhoto)
        assertEquals(ProblemCodeText.resId("validation.failed"), reasonText(validation))
        assertFalse(issue(SyncIssueState.REJECTED, code = "media.invalid").canSendWithoutPhoto)
        for (code in listOf(
            "forbidden",
            "not_found",
            "conflict",
            "validation.failed",
            "customer.deleted",
            "ledger.already_reversed",
            "ledger.reversal_mismatch",
            "plan.customer_limit",
            "media.invalid",
            "plan.photo_limit",
        )) {
            assertNotNull(ProblemCodeText.resId(code), code)
        }
    }

    @Test
    fun switchingShopsDropsOldIssuesAndActions() =
        runTest(dispatcher) {
            val shops = mockk<ShopRepository>()
            val repository = mockk<SyncIssueRepository>()
            val active = MutableStateFlow(shop())
            every { shops.observeActive() } returns active
            every { repository.observeIssues("shop") } returns MutableStateFlow(listOf(issue(SyncIssueState.REJECTED)))
            every { repository.observeIssues("other") } returns MutableStateFlow(emptyList())
            val model = SyncIssuesViewModel(shops, repository)
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.issues.collect {} }
            runCurrent()
            active.value = shop().copy(id = "other")
            runCurrent()
            assertTrue(model.issues.value.isEmpty())
            model.remove(issue(SyncIssueState.REJECTED)).join()
            coVerify(exactly = 0) { repository.dismiss(any(), any()) }
        }
}
