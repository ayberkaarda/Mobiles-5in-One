package app.cetele.android.feature.reminders.navigation

import kotlinx.serialization.Serializable

object ReminderRoutes {
    @Serializable
    data class Sheet(
        val customerId: String,
    )
}

interface ReminderNavigation {
    fun onBack()

    /** Opens the Çetele Pro screen after `sms.quota_exceeded` (owner only); `null` hides the button. */
    val onOpenBilling: (() -> Unit)?
        get() = null
}
