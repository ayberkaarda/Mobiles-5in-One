package app.cetele.android.feature.settings

import app.cetele.android.core.data.database.entity.OutboxEntity
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.feature.settings.sync.RoomSettingsIssueStore
import app.cetele.android.feature.settings.sync.SyncIssuesViewModel
import app.cetele.android.feature.settings.sync.canSendWithoutPhoto
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
    private fun row(
        state: String,
        photo: String? = null,
        code: String? = null,
    ) = OutboxEntity(
        "client",
        "shop",
        "ENTRY_CREATE",
        "entry",
        "{}",
        "2026-10-06T00:00:00Z",
        photoEntryId = photo,
        state = state,
        lastCode = code,
        updatedAt = "2026-10-06T00:00:00Z",
    )

    @Test
    fun onlyRejectedRowsCanBeDismissedAndPhotoBlocksCanBeReleased() =
        runTest(dispatcher) {
            val shops = mockk<ShopRepository>()
            val store = mockk<RoomSettingsIssueStore>()
            val rows = MutableStateFlow(listOf(row("REJECTED", code = "forbidden")))
            every { shops.observeActive() } returns MutableStateFlow(shop())
            every { store.observe("shop") } returns rows
            coEvery { store.remove(any(), any()) } returns true
            coEvery { store.withoutPhoto(any(), any()) } returns true
            val model = SyncIssuesViewModel(shops, store)
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.issues.collect {} }
            runCurrent()
            assertEquals(rows.value, model.issues.value)
            model.remove(rows.value.single()).join()
            rows.value = listOf(row("BLOCKED", "entry"))
            runCurrent()
            model.remove(rows.value.single()).join()
            model.withoutPhoto(rows.value.single()).join()
            coVerify(exactly = 1) { store.remove("shop", "client") }
            coVerify(exactly = 1) { store.withoutPhoto("shop", "client") }
            model.remove(row("REJECTED").copy(shopId = "other")).join()
            coVerify(exactly = 0) { store.remove("other", any()) }
        }

    @Test
    fun validationBlocksAndRejectionsCannotBeResentWithoutPhoto() {
        assertTrue(canSendWithoutPhoto(row("BLOCKED", "entry")))
        assertTrue(canSendWithoutPhoto(row("BLOCKED", "entry", "media.invalid")))
        assertTrue(canSendWithoutPhoto(row("BLOCKED", "entry", "plan.photo_limit")))
        assertFalse(canSendWithoutPhoto(row("BLOCKED", "entry", "validation.failed")))
        assertFalse(canSendWithoutPhoto(row("REJECTED", "entry", "media.invalid")))
        assertFalse(canSendWithoutPhoto(row("BLOCKED")))
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
            val store = mockk<RoomSettingsIssueStore>()
            val active = MutableStateFlow(shop())
            every { shops.observeActive() } returns active
            every { store.observe("shop") } returns MutableStateFlow(listOf(row("REJECTED")))
            every { store.observe("other") } returns MutableStateFlow(emptyList())
            val model = SyncIssuesViewModel(shops, store)
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { model.issues.collect {} }
            runCurrent()
            active.value = shop().copy(id = "other")
            runCurrent()
            assertTrue(model.issues.value.isEmpty())
            model.remove(row("REJECTED")).join()
            coVerify(exactly = 0) { store.remove(any(), any()) }
        }
}
