package app.cetele.android.navigation

import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.designsystem.component.SyncStatusSummary
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.feature.auth.navigation.AuthRoutes
import app.cetele.android.feature.customers.navigation.CustomerRoutes
import app.cetele.android.feature.export.navigation.ExportRoutes
import app.cetele.android.feature.ledger.navigation.LedgerRoutes
import app.cetele.android.feature.reminders.navigation.ReminderRoutes
import app.cetele.android.feature.settings.navigation.SettingsRoutes
import app.cetele.android.feature.shop.navigation.ShopRoutes
import app.cetele.android.startup.SyncRequests
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class FeatureNavigationsTest {
    private val navigator = RecordingNavigator()
    private val sync = RecordingSync()

    @Test
    fun `auth flow moves from phone to otp and clears the stack after sign-in`() {
        var shop: String? = null
        val auth = AppAuthNavigation(navigator) { shop }

        auth.onOtpRequested("+905551112233")
        auth.onPinSetupRequired()
        auth.onSignedIn()
        shop = "shop-1"
        auth.onSignedIn()

        assertEquals(
            listOf(
                "open" to AuthRoutes.Otp("+905551112233"),
                "replaceAll" to AuthRoutes.PinSetup,
                "replaceAll" to ShopRoutes.Switcher,
                "replaceAll" to LedgerRoutes.Dashboard,
            ),
            navigator.calls,
        )
    }

    @Test
    fun `unlock returns to the covered screen or opens home when the lock was the launch screen`() {
        val auth = AppAuthNavigation(navigator) { "shop-1" }

        navigator.previous = true
        auth.onUnlocked()
        navigator.previous = false
        auth.onUnlocked()

        assertEquals(listOf("back" to null, "replaceAll" to LedgerRoutes.Dashboard), navigator.calls)
    }

    @Test
    fun `ended session and sign-in again replace the whole stack`() {
        val auth = AppAuthNavigation(navigator) { null }

        auth.onSessionEnded(SignOutReason.REFRESH_INVALID)
        auth.onSignIn()

        assertEquals(
            listOf(
                "replaceAll" to AuthRoutes.SessionEnded(SignOutReason.REFRESH_INVALID),
                "replaceAll" to AuthRoutes.Phone,
            ),
            navigator.calls,
        )
    }

    @Test
    fun `selecting a shop schedules its sync and opens its dashboard`() {
        val shop = AppShopNavigation(navigator, sync)

        shop.onCreate()
        shop.onJoin()
        shop.onInvite()
        shop.onShopSelected("shop-7")
        shop.onShopEdited()

        assertEquals(listOf("periodic" to "shop-7", "now" to "shop-7"), sync.calls)
        assertEquals(
            listOf(
                "open" to ShopRoutes.Create,
                "open" to ShopRoutes.Join,
                "open" to ShopRoutes.Invite,
                "replaceAll" to LedgerRoutes.Dashboard,
                "back" to null,
            ),
            navigator.calls,
        )
    }

    @Test
    fun `customer detail actions open ledger, reminder and export destinations`() {
        val customers = AppCustomerNavigation(navigator, emptyFlow(), emptyFlow())

        customers.onCustomerSelected("c1")
        customers.onAddCustomer()
        customers.onEditCustomer("c1")
        customers.onAddEntry("c1", EntryType.PAYMENT)
        customers.onEntrySelected("e1")
        customers.onRemind("c1")
        customers.onExport("c1")

        assertEquals(
            listOf(
                "open" to CustomerRoutes.Detail("c1"),
                "open" to CustomerRoutes.Edit(),
                "open" to CustomerRoutes.Edit("c1"),
                "open" to LedgerRoutes.Entry("c1", "PAYMENT"),
                "open" to LedgerRoutes.EntryDetail("e1"),
                "open" to ReminderRoutes.Sheet("c1"),
                "open" to ExportRoutes.Statement("c1"),
            ),
            navigator.calls,
        )
    }

    @Test
    fun `saved customer returns to its detail or replaces the new-customer form`() {
        val customers = AppCustomerNavigation(navigator, emptyFlow(), emptyFlow())

        navigator.stack += CustomerRoutes.Detail("c1")
        customers.onCustomerSaved("c1")
        customers.onCustomerSaved("c2")

        assertEquals(
            listOf(
                "returnTo" to CustomerRoutes.Detail("c1"),
                "returnTo" to CustomerRoutes.Detail("c2"),
                "replaceCurrent" to CustomerRoutes.Detail("c2"),
            ),
            navigator.calls,
        )
    }

    @Test
    fun `deleted customer returns to the list, or one step back when opened from the dashboard`() {
        val customers = AppCustomerNavigation(navigator, emptyFlow(), emptyFlow())

        customers.onCustomerDeleted()
        navigator.stack += CustomerRoutes.List
        customers.onCustomerDeleted()

        assertEquals(
            listOf(
                "returnTo" to CustomerRoutes.List,
                "back" to null,
                "returnTo" to CustomerRoutes.List,
            ),
            navigator.calls,
        )
    }

    @Test
    fun `customer list reads the sync status handed in by the shell`() {
        val status = flowOf(SyncStatusSummary(pendingCount = 2))
        val limit = flowOf(true)

        val customers = AppCustomerNavigation(navigator, status, limit)

        assertEquals(status, customers.syncStatus)
        assertEquals(limit, customers.customerLimitRejected)
    }

    @Test
    fun `dashboard pull to refresh requests an immediate sync of that shop`() {
        val ledger = AppLedgerNavigation(navigator, sync)

        ledger.onRequestSync("shop-3")
        ledger.onCustomerSelected("c1")
        ledger.onEntrySelected("e1")
        ledger.onRemind("c1")
        ledger.onBack()

        assertEquals(listOf("now" to "shop-3"), sync.calls)
        assertEquals(
            listOf(
                "open" to CustomerRoutes.Detail("c1"),
                "open" to LedgerRoutes.EntryDetail("e1"),
                "open" to ReminderRoutes.Sheet("c1"),
                "back" to null,
            ),
            navigator.calls,
        )
    }

    @Test
    fun `settings opens its own routes and reports the installed version`() {
        val settings = AppSettingsNavigation(navigator, "0.3.0")
        val back = AppBackNavigation(navigator)

        settings.onNavigate(SettingsRoutes.About)
        settings.onBack()
        back.onBack()

        assertEquals("0.3.0", settings.appVersion)
        assertEquals(listOf("open" to SettingsRoutes.About, "back" to null, "back" to null), navigator.calls)
    }

    @Test
    fun `shell services reach every feature callback`() {
        var shop: String? = "shop-4"
        val services = ShellServices(sync, emptyFlow(), emptyFlow(), { shop }, "1.2.3")
        val navigations = AppNavigations(navigator, services)

        navigations.auth.onSignedIn()
        shop = null
        navigations.auth.onSignedIn()
        navigations.ledger.onRequestSync("shop-4")
        navigations.back.onBack()

        assertEquals("1.2.3", navigations.settings.appVersion)
        assertEquals(listOf("now" to "shop-4"), sync.calls)
        assertEquals(
            listOf(
                "replaceAll" to LedgerRoutes.Dashboard,
                "replaceAll" to ShopRoutes.Switcher,
                "back" to null,
            ),
            navigator.calls,
        )
    }

    private class RecordingNavigator : RouteNavigator {
        val calls = mutableListOf<Pair<String, Any?>>()
        val stack = mutableListOf<Any>()
        var previous = false

        override fun open(route: Any) {
            calls += "open" to route
        }

        override fun replaceAll(route: Any) {
            calls += "replaceAll" to route
        }

        override fun replaceCurrent(route: Any) {
            calls += "replaceCurrent" to route
        }

        override fun openTab(route: Any) {
            calls += "openTab" to route
        }

        override fun returnTo(route: Any): Boolean {
            calls += "returnTo" to route
            return route in stack
        }

        override fun back() {
            calls += "back" to null
        }

        override fun hasPrevious(): Boolean = previous
    }

    private class RecordingSync : SyncRequests {
        val calls = mutableListOf<Pair<String, String>>()

        override fun requestNow(shopId: String) {
            calls += "now" to shopId
        }

        override fun ensurePeriodic(shopId: String) {
            calls += "periodic" to shopId
        }
    }
}
