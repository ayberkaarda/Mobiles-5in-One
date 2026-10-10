package app.cetele.android.feature.settings.sync

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.repository.SyncIssue
import app.cetele.android.core.data.repository.SyncIssueRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class SyncIssuesViewModel
    @Inject
    constructor(
        shops: ShopRepository,
        private val repository: SyncIssueRepository,
    ) : ViewModel() {
        val issues =
            shops
                .observeActive()
                .flatMapLatest { shop ->
                    if (shop == null) flowOf(emptyList()) else repository.observeIssues(shop.id)
                }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

        fun remove(issue: SyncIssue) =
            viewModelScope.launch {
                if (issue.canDismiss && isShown(issue)) repository.dismiss(issue.shopId, issue.clientId)
            }

        fun withoutPhoto(issue: SyncIssue) =
            viewModelScope.launch {
                if (issue.canSendWithoutPhoto && isShown(issue)) {
                    repository.sendWithoutPhoto(issue.shopId, issue.entityId)
                }
            }

        /** Actions only apply to an issue of the active shop that is still listed. */
        private fun isShown(issue: SyncIssue): Boolean =
            issues.value.any { it.clientId == issue.clientId && it.shopId == issue.shopId }

        private companion object {
            const val STOP_TIMEOUT_MILLIS = 5000L
        }
    }
