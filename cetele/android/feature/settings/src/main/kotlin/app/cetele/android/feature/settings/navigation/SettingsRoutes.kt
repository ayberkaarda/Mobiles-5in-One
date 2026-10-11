package app.cetele.android.feature.settings.navigation

import kotlinx.serialization.Serializable

object SettingsRoutes {
    @Serializable data object Home

    @Serializable data object Profile

    @Serializable data object Lock

    @Serializable data object Devices

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

    /** Opens the plan and Çetele Pro screen of the active shop; `null` hides the entry. */
    val onOpenBilling: (() -> Unit)?
        get() = null

    /** Play's subscription page, linked from the deletion screens for owners (spec item 21); `null` hides it. */
    val subscriptionManageUrl: String?
        get() = null
}
