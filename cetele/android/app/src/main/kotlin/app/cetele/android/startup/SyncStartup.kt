package app.cetele.android.startup

import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.session.SessionState
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.data.sync.SyncScheduler
import app.cetele.android.core.data.sync.SyncTrigger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** The two scheduling calls the app shell makes; kept narrow so start-up logic is testable without WorkManager. */
interface SyncRequests {
    fun requestNow(shopId: String)

    fun ensurePeriodic(shopId: String)
}

class SchedulerSyncRequests
    @Inject
    constructor(
        private val scheduler: SyncScheduler,
    ) : SyncRequests {
        override fun requestNow(shopId: String) = scheduler.requestNow(shopId)

        override fun ensurePeriodic(shopId: String) = scheduler.ensurePeriodic(shopId)
    }

/**
 * Emits the active shop whenever a signed-in user has one: at start, after sign-in and after a shop switch.
 * Signing out resets the chain, so signing back in to the same shop schedules it again.
 */
fun activeShopWhileSignedIn(
    session: Flow<SessionState>,
    settings: Flow<UserSettings>,
): Flow<String> =
    combine(session, settings) { state, current ->
        current.activeShopId.takeIf { state is SessionState.SignedIn }
    }.distinctUntilChanged().filterNotNull()

@Singleton
class SyncStartup
    @Inject
    constructor(
        private val trigger: SyncTrigger,
        private val session: SessionManager,
        private val settings: SettingsRepository,
        private val requests: SyncRequests,
    ) {
        fun start(scope: CoroutineScope) {
            trigger.start(scope)
            scope.launch {
                activeShopWhileSignedIn(session.state, settings.settings).collect { shopId ->
                    requests.ensurePeriodic(shopId)
                    requests.requestNow(shopId)
                }
            }
        }
    }
