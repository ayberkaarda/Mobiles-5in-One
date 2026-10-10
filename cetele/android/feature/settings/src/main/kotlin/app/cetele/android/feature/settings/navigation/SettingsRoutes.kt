package app.cetele.android.feature.settings.navigation

import kotlinx.serialization.Serializable

object SettingsRoutes {
    @Serializable data object Home

    @Serializable data object Profile

    @Serializable data object Lock

    @Serializable data object SyncIssues

    @Serializable data object AccountDeletion

    @Serializable data object ShopDeletion

    @Serializable data object OwnershipTransfer

    @Serializable data object About
}

interface SettingsNavigation {
    val onNavigate: (Any) -> Unit
    val onBack: () -> Unit
    val appVersion: String
}
