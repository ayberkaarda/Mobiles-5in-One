package app.cetele.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.ThemeMode
import app.cetele.android.core.data.sync.SyncLocalStore
import app.cetele.android.core.data.sync.SyncStatus
import app.cetele.android.core.designsystem.component.SyncStatusSummary
import app.cetele.android.core.network.dto.problem.ProblemCodes
import app.cetele.android.navigation.AppGate
import app.cetele.android.navigation.ShellServices
import app.cetele.android.startup.SyncRequests
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/** Shell state: the session gate, the theme and the active shop's sync status for the customer list. */
@HiltViewModel
class AppViewModel
    @Inject
    constructor(
        session: SessionManager,
        settings: SettingsRepository,
        lock: LockController,
        syncStore: SyncLocalStore,
        syncRequests: SyncRequests,
    ) : ViewModel() {
        /** Null until the settings store has been read once. */
        val gate: StateFlow<AppGate?> =
            combine(session.state, settings.settings, lock.state, AppGate::from)
                .stateIn(viewModelScope, SharingStarted.Eagerly, null)

        val themeMode: StateFlow<ThemeMode> =
            settings.settings
                .map { it.themeMode }
                .stateIn(viewModelScope, SharingStarted.Eagerly, ThemeMode.SYSTEM)

        @OptIn(ExperimentalCoroutinesApi::class)
        private val activeStatus: Flow<SyncStatus> =
            settings.settings
                .map { it.activeShopId }
                .distinctUntilChanged()
                .flatMapLatest { shopId -> shopId?.let(syncStore::status) ?: flowOf(SyncStatus()) }

        val syncStatus: Flow<SyncStatusSummary> = activeStatus.map(SyncStatus::summary)

        val customerLimitRejected: Flow<Boolean> = activeStatus.map(SyncStatus::customerLimitReached)

        val services =
            ShellServices(
                sync = syncRequests,
                syncStatus = syncStatus,
                customerLimitRejected = customerLimitRejected,
                activeShopId = { gate.value?.activeShopId },
                appVersion = BuildConfig.VERSION_NAME,
            )
    }

fun SyncStatus.summary(): SyncStatusSummary = SyncStatusSummary(pendingCount, blockedCount, rejectedCount, offline)

/** The last sync stopped on the free plan's customer limit. */
fun SyncStatus.customerLimitReached(): Boolean = lastErrorCode == ProblemCodes.PLAN_CUSTOMER_LIMIT
