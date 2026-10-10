package app.cetele.android.navigation

import android.app.Application
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.feature.auth.navigation.AuthRoutes
import app.cetele.android.feature.customers.navigation.CustomerRoutes
import app.cetele.android.feature.ledger.navigation.LedgerRoutes
import app.cetele.android.feature.settings.navigation.SettingsRoutes
import app.cetele.android.shop.ShopHomeRoute
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Drives the real back stack with the feature route types to check the shell's stack moves. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class NavControllerNavigatorTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var controller: NavHostController
    private lateinit var navigator: NavControllerNavigator

    @Before
    fun setUp() {
        compose.setContent {
            controller = rememberNavController()
            NavHost(controller, startDestination = LedgerRoutes.Dashboard) {
                composable<LedgerRoutes.Dashboard> { Text("dashboard") }
                composable<LedgerRoutes.Entry> { Text("entry") }
                composable<CustomerRoutes.List> { Text("customers") }
                composable<CustomerRoutes.Detail> { Text("detail") }
                composable<CustomerRoutes.Edit> { Text("edit") }
                composable<ShopHomeRoute> { Text("shop") }
                composable<SettingsRoutes.Home> { Text("settings") }
                composable<AuthRoutes.Lock> { Text("lock") }
                composable<AuthRoutes.SessionEnded> { Text("ended") }
            }
        }
        compose.runOnIdle { navigator = NavControllerNavigator(controller) }
    }

    private fun onMain(action: () -> Unit) = compose.runOnIdle(action)

    private fun currentTab(): TopLevelDestination? = TopLevelDestination.of(controller.currentDestination)

    @Test
    fun tabsStackAboveTheDashboardAndBackReturnsToIt() {
        onMain {
            assertEquals(TopLevelDestination.TODAY, currentTab())
            navigator.openTab(CustomerRoutes.List)
            navigator.openTab(SettingsRoutes.Home)
            assertEquals(TopLevelDestination.SETTINGS, currentTab())
            navigator.back()
            assertEquals(TopLevelDestination.TODAY, currentTab())
            navigator.back()
            assertEquals(TopLevelDestination.TODAY, currentTab())
            assertFalse(navigator.hasPrevious())
        }
    }

    @Test
    fun savedEditReturnsToTheDetailWithTheSameId() {
        onMain {
            navigator.openTab(CustomerRoutes.List)
            navigator.open(CustomerRoutes.Detail("c1"))
            navigator.open(CustomerRoutes.Edit("c1"))
            assertFalse(navigator.returnTo(CustomerRoutes.Detail("other")))
            assertTrue(navigator.returnTo(CustomerRoutes.Detail("c1")))
            assertEquals("c1", controller.currentBackStackEntry!!.toRoute<CustomerRoutes.Detail>().customerId)
            assertNull(TopLevelDestination.of(controller.currentDestination))
        }
    }

    @Test
    fun newCustomerFormIsReplacedByItsDetail() {
        onMain {
            navigator.openTab(CustomerRoutes.List)
            navigator.open(CustomerRoutes.Edit())
            navigator.replaceCurrent(CustomerRoutes.Detail("c2"))
            assertEquals("c2", controller.currentBackStackEntry!!.toRoute<CustomerRoutes.Detail>().customerId)
            navigator.back()
            assertEquals(TopLevelDestination.CUSTOMERS, currentTab())
        }
    }

    @Test
    fun entryRouteCarriesTheTypeName() {
        onMain {
            navigator.open(LedgerRoutes.Entry("c1", EntryType.DEBT))
            val route = controller.currentBackStackEntry!!.toRoute<LedgerRoutes.Entry>()
            assertEquals(LedgerRoutes.Entry("c1", "DEBT"), route)
            assertEquals(RouteKind.PROTECTED, routeKind(controller.currentDestination!!))
        }
    }

    @Test
    fun lockIsPushedOverTheCurrentScreenAndEndedSessionClearsEverything() {
        onMain {
            navigator.openTab(ShopHomeRoute)
            navigator.open(AuthRoutes.Lock)
            assertEquals(RouteKind.LOCK, routeKind(controller.currentDestination!!))
            navigator.back()
            assertEquals(TopLevelDestination.SHOP, currentTab())

            navigator.replaceAll(AuthRoutes.SessionEnded(SignOutReason.MEMBERSHIP_LOST))
            val route = controller.currentBackStackEntry!!.toRoute<AuthRoutes.SessionEnded>()
            assertEquals(SignOutReason.MEMBERSHIP_LOST, route.reason)
            assertEquals(RouteKind.AUTH, routeKind(controller.currentDestination!!))
            assertFalse(navigator.hasPrevious())
        }
    }
}
