package app.cetele.android.startup

import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.session.SessionState
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopRole
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** The start-up half of the billing restore; kept narrow so the trigger is testable without Play. */
interface PurchaseRestore {
    suspend fun restore()
}

/**
 * Emits the signed-in user once per session, as soon as the shop list is loaded and holds a shop the user owns:
 * only an owner's purchases are linked (handoff 002, step 7). Signing out, or another user signing in, starts over.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun ownerSessions(
    session: Flow<SessionState>,
    shops: Flow<List<Shop>>,
): Flow<String> =
    session
        .map { (it as? SessionState.SignedIn)?.userId }
        .distinctUntilChanged()
        .flatMapLatest { userId ->
            if (userId == null) {
                emptyFlow()
            } else {
                flow {
                    shops.first { list -> list.any { it.role == ShopRole.OWNER } }
                    emit(userId)
                }
            }
        }

/** Runs [restore] for every owner session; a failed restore never ends the trigger or the process scope. */
fun CoroutineScope.restoreForOwnerSessions(
    session: Flow<SessionState>,
    shops: Flow<List<Shop>>,
    restore: PurchaseRestore,
): Job =
    launch {
        ownerSessions(session, shops).collect {
            try {
                restore.restore()
            } catch (_: IOException) {
                // The store or the server was not reachable; the next start or the billing screen retries.
            } catch (_: IllegalStateException) {
                // Billing is not available in this process state; the billing screen retries when opened.
            }
        }
    }

/** Restores Play purchases on app start (handoff 002, step 7); the billing screen restores again when opened. */
@Singleton
class BillingRestoreStartup
    @Inject
    constructor(
        private val session: SessionManager,
        private val shops: ShopRepository,
        private val restore: PurchaseRestore,
    ) {
        fun start(scope: CoroutineScope) {
            scope.restoreForOwnerSessions(session.state, shops.observeShops(), restore)
        }
    }
