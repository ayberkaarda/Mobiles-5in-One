package app.cetele.android.navigation

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.cetele.android.feature.auth.navigation.AuthRoutes
import app.cetele.android.feature.auth.navigation.authGraph
import app.cetele.android.feature.customers.navigation.customersGraph
import app.cetele.android.feature.export.navigation.exportGraph
import app.cetele.android.feature.ledger.navigation.ledgerGraph
import app.cetele.android.feature.reminders.navigation.remindersGraph
import app.cetele.android.feature.settings.navigation.settingsGraph
import app.cetele.android.feature.shop.navigation.shopGraph
import app.cetele.android.shop.ShopHomeRoute

/** Single host of all feature graphs. [startRoute] is fixed for the host's lifetime; later moves follow [gate]. */
@Composable
fun CeteleNavHost(
    services: ShellServices,
    gate: AppGate,
    startRoute: Any,
    modifier: Modifier = Modifier,
) {
    val controller = rememberNavController()
    val navigator = remember(controller) { NavControllerNavigator(controller) }
    val navigations = remember(navigator, services) { AppNavigations(navigator, services) }
    val entry by controller.currentBackStackEntryAsState()
    val destination = entry?.destination
    GateEffect(gate, destination, navigator)
    val tab = TopLevelDestination.of(destination)
    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0),
        bottomBar = { if (tab != null) TopLevelBar(tab, navigator::openTab) },
    ) { padding ->
        NavHost(
            navController = controller,
            startDestination = startRoute,
            modifier = Modifier.padding(padding).consumeWindowInsets(padding),
        ) {
            authGraph(navigations.auth)
            shopGraph(navigations.shop)
            customersGraph(navigations.customers)
            ledgerGraph(navigations.ledger, services.refreshing)
            remindersGraph(navigations.back)
            exportGraph(navigations.back)
            settingsGraph(navigations.settings)
            composable<ShopHomeRoute> { ShopHomeRoute(onOpen = navigator::open) }
        }
    }
}

@Composable
private fun GateEffect(
    gate: AppGate,
    destination: NavDestination?,
    navigator: RouteNavigator,
) {
    val current by rememberUpdatedState(destination)
    LaunchedEffect(gate, destination?.id) {
        val shown = current ?: return@LaunchedEffect
        when (val target = gate.redirect(routeKind(shown))) {
            null -> Unit
            AuthRoutes.Lock -> navigator.open(target)
            else -> navigator.replaceAll(target)
        }
    }
}

@Composable
private fun TopLevelBar(
    selected: TopLevelDestination,
    onSelect: (Any) -> Unit,
) {
    NavigationBar {
        TopLevelDestination.entries.forEach { tab ->
            val label = stringResource(tab.label)
            NavigationBarItem(
                selected = tab == selected,
                onClick = { onSelect(tab.route) },
                icon = { Icon(tab.icon, contentDescription = null) },
                label = { Text(label) },
            )
        }
    }
}
