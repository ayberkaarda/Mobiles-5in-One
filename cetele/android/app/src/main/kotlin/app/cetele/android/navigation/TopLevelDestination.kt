package app.cetele.android.navigation

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hasRoute
import app.cetele.android.R
import app.cetele.android.feature.auth.navigation.AuthRoutes
import app.cetele.android.feature.customers.navigation.CustomerRoutes
import app.cetele.android.feature.ledger.navigation.LedgerRoutes
import app.cetele.android.feature.settings.navigation.SettingsRoutes
import app.cetele.android.shop.ShopHomeRoute
import kotlin.reflect.KClass

/** The bottom bar tabs, in display order; each is the root of its own stack above the dashboard. */
enum class TopLevelDestination(
    val route: Any,
    @param:StringRes val label: Int,
    val icon: ImageVector,
) {
    TODAY(LedgerRoutes.Dashboard, R.string.app_tab_today, Icons.Filled.Home),
    CUSTOMERS(CustomerRoutes.List, R.string.app_tab_customers, Icons.Filled.Person),
    SHOP(ShopHomeRoute, R.string.app_tab_shop, Icons.Filled.ShoppingCart),
    SETTINGS(SettingsRoutes.Home, R.string.app_tab_settings, Icons.Filled.Settings),
    ;

    fun matches(destination: NavDestination?): Boolean = destination?.hasRoute(route::class) == true

    companion object {
        fun of(destination: NavDestination?): TopLevelDestination? = entries.firstOrNull { it.matches(destination) }
    }
}

private val authRoutes: List<KClass<*>> =
    listOf(
        AuthRoutes.Phone::class,
        AuthRoutes.Otp::class,
        AuthRoutes.PinSetup::class,
        AuthRoutes.SessionEnded::class,
    )

fun routeKind(destination: NavDestination): RouteKind =
    when {
        destination.hasRoute(AuthRoutes.Lock::class) -> RouteKind.LOCK
        authRoutes.any { destination.hasRoute(it) } -> RouteKind.AUTH
        else -> RouteKind.PROTECTED
    }
