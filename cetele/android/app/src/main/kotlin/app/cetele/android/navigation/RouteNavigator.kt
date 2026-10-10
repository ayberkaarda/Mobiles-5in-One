package app.cetele.android.navigation

import androidx.navigation.NavHostController
import app.cetele.android.feature.ledger.navigation.LedgerRoutes

/** The back stack operations the feature callbacks need, so the wiring can be checked without a host. */
interface RouteNavigator {
    /** Pushes [route]; a second tap on the same destination does not stack a copy. */
    fun open(route: Any)

    /** Clears the whole back stack and shows [route] as its only entry. */
    fun replaceAll(route: Any)

    /** Swaps the current entry for [route]. */
    fun replaceCurrent(route: Any)

    /** Switches to a top-level tab on top of the dashboard, keeping each tab's own stack. */
    fun openTab(route: Any)

    /** Pops back to [route] if it is on the back stack, returning false otherwise. */
    fun returnTo(route: Any): Boolean

    /** Pops the current entry unless it is the only one. */
    fun back()

    fun hasPrevious(): Boolean
}

class NavControllerNavigator(
    private val controller: NavHostController,
) : RouteNavigator {
    override fun open(route: Any) {
        controller.navigate(route) { launchSingleTop = true }
    }

    override fun replaceAll(route: Any) {
        controller.navigate(route) {
            popUpTo(controller.graph.id) { inclusive = true }
            launchSingleTop = true
        }
    }

    override fun replaceCurrent(route: Any) {
        val current = controller.currentBackStackEntry?.destination?.id
        controller.navigate(route) {
            if (current != null) popUpTo(current) { inclusive = true }
            launchSingleTop = true
        }
    }

    override fun openTab(route: Any) {
        controller.navigate(route) {
            popUpTo(LedgerRoutes.Dashboard) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }

    override fun returnTo(route: Any): Boolean = controller.popBackStack(route, inclusive = false)

    override fun back() {
        if (hasPrevious()) controller.popBackStack()
    }

    override fun hasPrevious(): Boolean = controller.previousBackStackEntry != null
}
