package app.cetele.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.repository.SyncIssueRepository
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.ThemeMode
import app.cetele.android.navigation.AppGate
import app.cetele.android.navigation.ShellServices
import app.cetele.android.startup.SyncRequests
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/** Shell state: the session gate, the theme and the active shop's sync state for the feature screens. */
@HiltViewModel
class AppViewModel
    @Inject
    constructor(
        session: SessionManager,
        settings: SettingsRepository,
        lock: LockController,
        syncIssues: SyncIssueRepository,
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

        private val activeSync =
            ActiveShopSync(settings.settings.map { it.activeShopId }.distinctUntilChanged(), syncIssues)

        val services =
            ShellServices(
                sync = syncRequests,
                syncStatus = activeSync.summary,
                customerLimitRejected = activeSync.customerLimitRejected,
                activeShopId = { gate.value?.activeShopId },
                appVersion = BuildConfig.VERSION_NAME,
                refreshing = activeSync.refreshing,
            )
    }
