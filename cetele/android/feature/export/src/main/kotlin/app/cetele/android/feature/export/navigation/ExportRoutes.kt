package app.cetele.android.feature.export.navigation

import kotlinx.serialization.Serializable

object ExportRoutes {
    @Serializable
    data class Statement(
        val customerId: String,
    )

    @Serializable
    data object All

    /** Owner-only encrypted `.cetele` export. */
    @Serializable
    data object Backup

    /** Owner-only import of a `.cetele` file. */
    @Serializable
    data object Restore
}
