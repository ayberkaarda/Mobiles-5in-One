package app.cetele.android.navigation

import app.cetele.android.core.data.lock.LockState
import app.cetele.android.core.data.session.SessionState
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.feature.auth.navigation.AuthRoutes
import app.cetele.android.feature.ledger.navigation.LedgerRoutes
import app.cetele.android.feature.shop.navigation.ShopRoutes

/** Everything the shell needs to decide where the user may be. */
data class AppGate(
    val signedIn: Boolean,
    val signOutReason: SignOutReason? = null,
    val pinSetupDone: Boolean = false,
    val locked: Boolean = false,
    val activeShopId: String? = null,
) {
    companion object {
        fun from(
            session: SessionState,
            settings: UserSettings,
            lock: LockState,
        ): AppGate =
            AppGate(
                signedIn = session is SessionState.SignedIn,
                signOutReason = (session as? SessionState.SignedOut)?.reason,
                pinSetupDone = settings.pinSetupDone,
                locked = lock == LockState.Locked,
                activeShopId = settings.activeShopId,
            )
    }
}

/** Where a destination sits relative to the session: before it, the lock itself, or behind both. */
enum class RouteKind { AUTH, LOCK, PROTECTED }

/** First screen of a signed-in, unlocked user: the dashboard, or the shop picker until a shop is active. */
fun homeRoute(activeShopId: String?): Any = if (activeShopId == null) ShopRoutes.Switcher else LedgerRoutes.Dashboard

/** Start destination at launch. */
fun AppGate.startRoute(): Any =
    when {
        !signedIn -> AuthRoutes.Phone
        !pinSetupDone -> AuthRoutes.PinSetup
        locked -> AuthRoutes.Lock
        else -> homeRoute(activeShopId)
    }

/**
 * Where the shell must move the user when the gate changes while [current] is shown, or null to stay.
 * A session that ends behind the sign-in screens shows why it ended; a lock covers any signed-in screen.
 */
fun AppGate.redirect(current: RouteKind): Any? =
    when {
        !signedIn && current != RouteKind.AUTH -> AuthRoutes.SessionEnded(signOutReason ?: SignOutReason.USER)
        signedIn && locked && current == RouteKind.PROTECTED -> AuthRoutes.Lock
        else -> null
    }
