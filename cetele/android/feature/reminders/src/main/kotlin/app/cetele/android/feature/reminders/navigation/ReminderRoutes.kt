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
}
