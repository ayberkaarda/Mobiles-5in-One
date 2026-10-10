package app.cetele.android.navigation

import app.cetele.android.core.data.lock.LockState
import app.cetele.android.core.data.session.SessionState
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.feature.auth.navigation.AuthRoutes
import app.cetele.android.feature.ledger.navigation.LedgerRoutes
import app.cetele.android.feature.shop.navigation.ShopRoutes
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class AppGateTest {
    private val ready = AppGate(signedIn = true, pinSetupDone = true, activeShopId = "shop-1")

    @Test
    fun `signed out launch starts at the phone screen`() {
        assertEquals(AuthRoutes.Phone, AppGate(signedIn = false).startRoute())
    }

    @Test
    fun `signed in user without a pin starts at pin setup even when a shop is active`() {
        assertEquals(AuthRoutes.PinSetup, ready.copy(pinSetupDone = false).startRoute())
    }

    @Test
    fun `locked launch starts at the lock screen`() {
        assertEquals(AuthRoutes.Lock, ready.copy(locked = true).startRoute())
    }

    @Test
    fun `unlocked launch opens the dashboard of the active shop`() {
        assertEquals(LedgerRoutes.Dashboard, ready.startRoute())
    }

    @Test
    fun `unlocked launch without an active shop opens the shop picker`() {
        assertEquals(ShopRoutes.Switcher, ready.copy(activeShopId = null).startRoute())
        assertEquals(ShopRoutes.Switcher, homeRoute(null))
    }

    @Test
    fun `gate reads session, settings and lock state`() {
        val gate =
            AppGate.from(
                SessionState.SignedIn("user-1", "+905551112233"),
                UserSettings(activeShopId = "shop-9", pinSetupDone = true),
                LockState.Locked,
            )

        assertEquals(AppGate(true, null, pinSetupDone = true, locked = true, activeShopId = "shop-9"), gate)
        val ended =
            AppGate.from(SessionState.SignedOut(SignOutReason.MEMBERSHIP_LOST), UserSettings(), LockState.NoPin)
        assertFalse(ended.signedIn)
        assertFalse(ended.locked)
        assertEquals(SignOutReason.MEMBERSHIP_LOST, ended.signOutReason)
    }

    @Test
    fun `session ending behind the sign-in screens shows its reason`() {
        val ended = AppGate(signedIn = false, signOutReason = SignOutReason.ACCOUNT_DELETED)

        assertEquals(AuthRoutes.SessionEnded(SignOutReason.ACCOUNT_DELETED), ended.redirect(RouteKind.PROTECTED))
        assertEquals(AuthRoutes.SessionEnded(SignOutReason.ACCOUNT_DELETED), ended.redirect(RouteKind.LOCK))
        assertEquals(
            AuthRoutes.SessionEnded(SignOutReason.USER),
            AppGate(signedIn = false).redirect(RouteKind.PROTECTED),
        )
    }

    @Test
    fun `sign-in screens are left alone while signed out`() {
        assertNull(AppGate(signedIn = false, signOutReason = SignOutReason.USER).redirect(RouteKind.AUTH))
    }

    @Test
    fun `lock covers signed-in screens only`() {
        val locked = ready.copy(locked = true)

        assertEquals(AuthRoutes.Lock, locked.redirect(RouteKind.PROTECTED))
        assertNull(locked.redirect(RouteKind.LOCK))
        assertNull(locked.redirect(RouteKind.AUTH))
        assertNull(ready.redirect(RouteKind.PROTECTED))
    }
}
