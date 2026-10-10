package app.cetele.android.navigation

import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.designsystem.component.SyncStatusSummary
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.feature.auth.navigation.AuthNavigation
import app.cetele.android.feature.auth.navigation.AuthRoutes
import app.cetele.android.feature.customers.navigation.CustomerNavigation
import app.cetele.android.feature.customers.navigation.CustomerRoutes
import app.cetele.android.feature.export.navigation.ExportNavigation
import app.cetele.android.feature.export.navigation.ExportRoutes
import app.cetele.android.feature.ledger.navigation.LedgerNavigation
import app.cetele.android.feature.ledger.navigation.LedgerRoutes
import app.cetele.android.feature.reminders.navigation.ReminderNavigation
import app.cetele.android.feature.reminders.navigation.ReminderRoutes
import app.cetele.android.feature.settings.navigation.SettingsNavigation
import app.cetele.android.feature.shop.navigation.ShopNavigation
import app.cetele.android.feature.shop.navigation.ShopRoutes
import app.cetele.android.startup.SyncRequests
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

class AppAuthNavigation(
    private val navigator: RouteNavigator,
    private val activeShopId: () -> String?,
) : AuthNavigation {
    override fun onOtpRequested(phone: String) = navigator.open(AuthRoutes.Otp(phone))

    override fun onPinSetupRequired() = navigator.replaceAll(AuthRoutes.PinSetup)

    override fun onSignedIn() = navigator.replaceAll(homeRoute(activeShopId()))

    /** A lock raised over a screen returns to it; a lock shown at launch opens the home screen. */
    override fun onUnlocked() {
        if (navigator.hasPrevious()) navigator.back() else navigator.replaceAll(homeRoute(activeShopId()))
    }

    override fun onSessionEnded(reason: SignOutReason) = navigator.replaceAll(AuthRoutes.SessionEnded(reason))

    override fun onSignIn() = navigator.replaceAll(AuthRoutes.Phone)

    override fun onBack() = navigator.back()
}

class AppShopNavigation(
    private val navigator: RouteNavigator,
    private val sync: SyncRequests,
) : ShopNavigation {
    override fun onBack() = navigator.back()

    override fun onCreate() = navigator.open(ShopRoutes.Create)

    override fun onJoin() = navigator.open(ShopRoutes.Join)

    override fun onInvite() = navigator.open(ShopRoutes.Invite)

    /** The view models already made the shop active; the shell starts its sync and opens its dashboard. */
    override fun onShopSelected(shopId: String) {
        sync.ensurePeriodic(shopId)
        sync.requestNow(shopId)
        navigator.replaceAll(LedgerRoutes.Dashboard)
    }

    override fun onShopEdited() = navigator.back()
}

class AppCustomerNavigation(
    private val navigator: RouteNavigator,
    override val syncStatus: Flow<SyncStatusSummary>,
    override val customerLimitRejected: Flow<Boolean>,
) : CustomerNavigation {
    override fun onCustomerSelected(customerId: String) = navigator.open(CustomerRoutes.Detail(customerId))

    override fun onAddCustomer() = navigator.open(CustomerRoutes.Edit())

    override fun onEditCustomer(customerId: String) = navigator.open(CustomerRoutes.Edit(customerId))

    /** Editing returns to the detail underneath; a new customer's form is replaced by its detail. */
    override fun onCustomerSaved(customerId: String) {
        val detail = CustomerRoutes.Detail(customerId)
        if (!navigator.returnTo(detail)) navigator.replaceCurrent(detail)
    }

    override fun onCustomerDeleted() {
        if (!navigator.returnTo(CustomerRoutes.List)) navigator.back()
    }

    override fun onAddEntry(
        customerId: String,
        type: EntryType,
    ) = navigator.open(LedgerRoutes.Entry(customerId, type))

    override fun onEntrySelected(entryId: String) = navigator.open(LedgerRoutes.EntryDetail(entryId))

    override fun onRemind(customerId: String) = navigator.open(ReminderRoutes.Sheet(customerId))

    override fun onExport(customerId: String) = navigator.open(ExportRoutes.Statement(customerId))

    override fun onBack() = navigator.back()
}

class AppLedgerNavigation(
    private val navigator: RouteNavigator,
    private val sync: SyncRequests,
) : LedgerNavigation {
    override fun onBack() = navigator.back()

    override fun onEntrySelected(entryId: String) = navigator.open(LedgerRoutes.EntryDetail(entryId))

    override fun onCustomerSelected(customerId: String) = navigator.open(CustomerRoutes.Detail(customerId))

    override fun onRemind(customerId: String) = navigator.open(ReminderRoutes.Sheet(customerId))

    override fun onRequestSync(shopId: String) = sync.requestNow(shopId)
}

class AppBackNavigation(
    private val navigator: RouteNavigator,
) : ReminderNavigation,
    ExportNavigation {
    override fun onBack() = navigator.back()
}

class AppSettingsNavigation(
    navigator: RouteNavigator,
    override val appVersion: String,
) : SettingsNavigation {
    override val onNavigate: (Any) -> Unit = navigator::open
    override val onBack: () -> Unit = navigator::back
}

/** What the shell hands to the feature callbacks: sync scheduling, the active shop and its sync status. */
class ShellServices(
    val sync: SyncRequests,
    val syncStatus: Flow<SyncStatusSummary>,
    val customerLimitRejected: Flow<Boolean>,
    val activeShopId: () -> String?,
    val appVersion: String,
    /** True while the active shop has changes on their way to the server; feeds the dashboard refresh indicator. */
    val refreshing: Flow<Boolean> = flowOf(false),
)

/** Every feature's callbacks, built once per host. */
class AppNavigations(
    navigator: RouteNavigator,
    services: ShellServices,
) {
    val auth = AppAuthNavigation(navigator, services.activeShopId)
    val shop = AppShopNavigation(navigator, services.sync)
    val customers = AppCustomerNavigation(navigator, services.syncStatus, services.customerLimitRejected)
    val ledger = AppLedgerNavigation(navigator, services.sync)
    val back = AppBackNavigation(navigator)
    val settings = AppSettingsNavigation(navigator, services.appVersion)
}
