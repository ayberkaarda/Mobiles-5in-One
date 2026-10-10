package app.cetele.android.feature.settings.navigation

import androidx.biometric.BiometricManager
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import app.cetele.android.feature.settings.about.AboutScreen
import app.cetele.android.feature.settings.account.AccountDeletionScreen
import app.cetele.android.feature.settings.account.AccountDeletionViewModel
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
        AccountDeletionScreen(
            state,
            { model.requestCode() },
            { code, all -> model.delete(code, all) },
            { nav.onNavigate(SettingsRoutes.OwnershipTransfer) },
            model::dismissChoice,
            nav.onBack,
        )
    }
    composable<SettingsRoutes.ShopDeletion> {
        val model = hiltViewModel<ShopDeletionViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        ShopDeletionScreen(state, { model.requestCode() }, { model.delete(it) }, { model.cancel() }, nav.onBack)
    }
    composable<SettingsRoutes.OwnershipTransfer> {
        val model = hiltViewModel<OwnershipTransferViewModel>()
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(model) { model.load() }
        OwnershipTransferScreen(state, model::select, { model.requestCode() }, { model.transfer(it) }, nav.onBack)
    }
    composable<SettingsRoutes.About> { AboutScreen(nav.appVersion, nav.onBack) }
}
