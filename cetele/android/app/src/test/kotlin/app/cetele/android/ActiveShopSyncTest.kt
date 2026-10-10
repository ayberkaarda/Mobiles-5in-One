package app.cetele.android

import app.cetele.android.core.data.repository.PhotoUploadState
import app.cetele.android.core.data.repository.SyncIssue
import app.cetele.android.core.data.repository.SyncIssueRepository
import app.cetele.android.core.data.repository.SyncIssueState
import app.cetele.android.core.data.sync.SyncStatus
import app.cetele.android.core.designsystem.component.SyncStatusSummary
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.problem.ProblemCodes
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ActiveShopSyncTest {
    private val repository = FakeIssues()
    private val active = MutableStateFlow<String?>("shop-a")
    private val sync = ActiveShopSync(active, repository)

    @Test
    fun `refreshing while changes are pending and the device is online`() =
        runTest {
            repository.status("shop-a").value = SyncStatus(pendingCount = 2)
            assertTrue(sync.refreshing.first())

            repository.status("shop-a").value = SyncStatus(pendingCount = 2, offline = true)
            assertFalse(sync.refreshing.first())

            repository.status("shop-a").value = SyncStatus(pendingCount = 0, rejectedCount = 1)
            assertFalse(sync.refreshing.first())
        }

    @Test
    fun `status follows the active shop and is idle without one`() =
        runTest {
            repository.status("shop-a").value = SyncStatus(pendingCount = 3)
            repository.status("shop-b").value = SyncStatus(blockedCount = 1, offline = true)

            assertEquals(SyncStatusSummary(pendingCount = 3), sync.summary.first())
            active.value = "shop-b"
            assertEquals(SyncStatusSummary(blockedCount = 1, offline = true), sync.summary.first())
            active.value = null
            assertEquals(SyncStatusSummary(), sync.summary.first())
            assertFalse(sync.refreshing.first())
        }

    @Test
    fun `customer limit banner needs a rejected operation with the plan code`() =
        runTest {
            repository.issues("shop-a").value = listOf(issue("c1", SyncIssueState.REJECTED, "validation.failed"))
            assertFalse(sync.customerLimitRejected.first())

            repository.issues("shop-a").value =
                listOf(issue("c2", SyncIssueState.BLOCKED, ProblemCodes.PLAN_CUSTOMER_LIMIT))
            assertFalse(sync.customerLimitRejected.first())

            repository.issues("shop-a").value =
                listOf(
                    issue("c1", SyncIssueState.REJECTED, "validation.failed"),
                    issue("c3", SyncIssueState.REJECTED, ProblemCodes.PLAN_CUSTOMER_LIMIT),
                )
            assertTrue(sync.customerLimitRejected.first())
        }

    @Test
    fun `dismissing the rejected operation clears the banner and a last error code alone does not raise it`() =
        runTest {
            repository.status("shop-a").value = SyncStatus(lastErrorCode = ProblemCodes.PLAN_CUSTOMER_LIMIT)
            assertFalse(sync.customerLimitRejected.first())

            repository.issues("shop-a").value =
                listOf(issue("c3", SyncIssueState.REJECTED, ProblemCodes.PLAN_CUSTOMER_LIMIT))
            assertTrue(sync.customerLimitRejected.first())

            assertTrue(repository.dismiss("shop-a", "c3"))
            assertFalse(sync.customerLimitRejected.first())
        }

    @Test
    fun `the banner belongs to the active shop`() =
        runTest {
            repository.issues("shop-b").value =
                listOf(issue("c9", SyncIssueState.REJECTED, ProblemCodes.PLAN_CUSTOMER_LIMIT, "shop-b"))
            assertFalse(sync.customerLimitRejected.first())
            active.value = "shop-b"
            assertTrue(sync.customerLimitRejected.first())
            active.value = null
            assertFalse(sync.customerLimitRejected.first())
        }

    private fun issue(
        clientId: String,
        state: SyncIssueState,
        code: String?,
        shopId: String = "shop-a",
    ) = SyncIssue(shopId, clientId, SyncKind.CUSTOMER_UPSERT, "customer-1", state, code, null, "2026-10-10T08:00:00Z")

    private class FakeIssues : SyncIssueRepository {
        private val statuses = mutableMapOf<String, MutableStateFlow<SyncStatus>>()
        private val issueLists = mutableMapOf<String, MutableStateFlow<List<SyncIssue>>>()

        fun status(shopId: String) = statuses.getOrPut(shopId) { MutableStateFlow(SyncStatus()) }

        fun issues(shopId: String) = issueLists.getOrPut(shopId) { MutableStateFlow(emptyList()) }

        override fun observeIssues(shopId: String): Flow<List<SyncIssue>> = issues(shopId)

        override fun observeStatus(shopId: String): Flow<SyncStatus> = status(shopId)

        override fun observePhotoUpload(
            shopId: String,
            entryId: String,
        ): Flow<PhotoUploadState> = flowOf(PhotoUploadState.Absent)

        override suspend fun dismiss(
            shopId: String,
            clientId: String,
        ): Boolean {
            val list = issues(shopId)
            val target = list.value.firstOrNull { it.clientId == clientId && it.canDismiss } ?: return false
            list.value = list.value - target
            return true
        }

        override suspend fun sendWithoutPhoto(
            shopId: String,
            entryId: String,
        ): Boolean = false
    }
}
