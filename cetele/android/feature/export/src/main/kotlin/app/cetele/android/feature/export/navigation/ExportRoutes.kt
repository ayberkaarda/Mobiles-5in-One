package app.cetele.android.feature.export.navigation

import kotlinx.serialization.Serializable

object ExportRoutes {
    @Serializable
    data class Statement(
        val customerId: String,
    )

    @Serializable
    data object All
}
