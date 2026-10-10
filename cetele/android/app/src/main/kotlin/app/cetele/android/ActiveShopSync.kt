package app.cetele.android

import app.cetele.android.core.data.repository.SyncIssue
import app.cetele.android.core.data.repository.SyncIssueRepository
import app.cetele.android.core.data.repository.SyncIssueState
import app.cetele.android.core.data.sync.SyncStatus
import app.cetele.android.core.designsystem.component.SyncStatusSummary
import app.cetele.android.core.network.dto.problem.ProblemCodes
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/** Sync state of whichever shop is active, read from the sync issue repository and re-targeted on a shop switch. */
@OptIn(ExperimentalCoroutinesApi::class)
class ActiveShopSync(
    activeShopId: Flow<String?>,
    issues: SyncIssueRepository,
) {
    private val status: Flow<SyncStatus> =
        activeShopId.flatMapLatest { shopId ->
            shopId?.let(issues::observeStatus) ?: flowOf(SyncStatus())
        }

    val summary: Flow<SyncStatusSummary> = status.map(SyncStatus::summary).distinctUntilChanged()

    val refreshing: Flow<Boolean> = status.map(SyncStatus::isSending).distinctUntilChanged()

    /** A rejected operation still carries the free plan's customer limit; dismissing it clears the banner. */
    val customerLimitRejected: Flow<Boolean> =
        activeShopId
            .flatMapLatest { shopId ->
                shopId?.let(issues::observeIssues) ?: flowOf(emptyList())
            }.map(List<SyncIssue>::hasCustomerLimitRejection)
            .distinctUntilChanged()
}

fun SyncStatus.summary(): SyncStatusSummary = SyncStatusSummary(pendingCount, blockedCount, rejectedCount, offline)

/** Changes are waiting to be pushed and the device can reach the server. */
fun SyncStatus.isSending(): Boolean = pendingCount > 0 && !offline

fun List<SyncIssue>.hasCustomerLimitRejection(): Boolean =
    any { it.state == SyncIssueState.REJECTED && it.code == ProblemCodes.PLAN_CUSTOMER_LIMIT }
