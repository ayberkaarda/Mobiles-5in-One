package app.cetele.android.feature.settings.navigation

import androidx.biometric.BiometricManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import app.cetele.android.feature.settings.about.AboutScreen
import app.cetele.android.feature.settings.account.AccountDeletionScreen
import app.cetele.android.feature.settings.account.AccountDeletionViewModel
import app.cetele.android.feature.settings.devices.DevicesScreen
import app.cetele.android.feature.settings.devices.DevicesViewModel
import app.cetele.android.feature.settings.home.SettingsHomeScreen
import app.cetele.android.feature.settings.home.SettingsHomeViewModel
import app.cetele.android.feature.settings.lock.LockSettingsScreen
import app.cetele.android.feature.settings.lock.LockSettingsViewModel
import app.cetele.android.feature.settings.profile.ProfileScreen
import app.cetele.android.feature.settings.profile.ProfileViewModel
import app.cetele.android.feature.settings.shop.OwnershipTransferScreen
import app.cetele.android.feature.settings.shop.OwnershipTransferViewModel
import app.cetele.android.feature.settings.shop.ShopDeletionScreen
import app.cetele.android.feature.settings.shop.ShopDeletionViewModel
import app.cetele.android.feature.settings.sync.SyncIssuesScreen
import app.cetele.android.feature.settings.sync.SyncIssuesViewModel

@Suppress("LongMethod")
fun NavGraphBuilder.settingsGraph(nav: SettingsNavigation) {
    composable<SettingsRoutes.Devices> {
        val model = hiltViewModel<DevicesViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(model) { model.load() }
        DevicesScreen(
            state,
            model::select,
            { model.requestCode() },
            { model.signOut(it) },
            model::dismiss,
            { model.load() },
            nav.onBack,
        )
    }
    composable<SettingsRoutes.Home> {
        val model = hiltViewModel<SettingsHomeViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(model) { model.refresh() }
        SettingsHomeScreen(
            state,
            nav.onNavigate,
            { model.cancelDeletion() },
            { model.theme(it) },
            model::requestSignOut,
            { model.confirmSignOut() },
            model::dismissSignOut,
            nav.onOpenBilling,
        )
    }
    composable<SettingsRoutes.Profile> {
        val model = hiltViewModel<ProfileViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(model) { model.load() }
        ProfileScreen(state, model::name, { model.save() }, nav.onBack)
    }
    composable<SettingsRoutes.Lock> {
        val model = hiltViewModel<LockSettingsViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        val available =
            BiometricManager
                .from(LocalContext.current)
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
        LockSettingsScreen(state, available, { old, pin, repeat, biometric, timeout, supported ->
            model.save(old, pin, repeat, biometric, timeout, supported)
        }, nav.onBack)
    }
    composable<SettingsRoutes.SyncIssues> {
        val model = hiltViewModel<SyncIssuesViewModel>()
        val issues by model.issues.collectAsStateWithLifecycle()
        SyncIssuesScreen(issues, { model.remove(it) }, { model.withoutPhoto(it) }, nav.onBack)
    }
    composable<SettingsRoutes.AccountDeletion> {
        val model = hiltViewModel<AccountDeletionViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        val owner by model.ownsShop.collectAsStateWithLifecycle(false)
        val manage = rememberSubscriptionPage(nav.subscriptionManageUrl)
        AccountDeletionScreen(
            state,
            { model.requestCode() },
            { code, all -> model.delete(code, all) },
            { nav.onNavigate(SettingsRoutes.OwnershipTransfer) },
            model::dismissChoice,
            nav.onBack,
            manage.takeIf { owner },
        )
    }
    composable<SettingsRoutes.ShopDeletion> {
        val model = hiltViewModel<ShopDeletionViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        val manage = rememberSubscriptionPage(nav.subscriptionManageUrl)
        ShopDeletionScreen(
            state,
            { model.requestCode() },
            { model.delete(it) },
            { model.cancel() },
            nav.onBack,
            manage,
        )
    }
    composable<SettingsRoutes.OwnershipTransfer> {
        val model = hiltViewModel<OwnershipTransferViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(model) { model.load() }
        OwnershipTransferScreen(state, model::select, { model.requestCode() }, { model.transfer(it) }, nav.onBack)
    }
    composable<SettingsRoutes.About> { AboutScreen(nav.appVersion, nav.onBack) }
}

/** Opens Play's subscription page; a device without a browser simply stays on the screen. */
@Composable
private fun rememberSubscriptionPage(url: String?): (() -> Unit)? {
    val uriHandler = LocalUriHandler.current
    return remember(url, uriHandler) {
        url?.let { page -> { runCatching { uriHandler.openUri(page) } } }
    }
}
