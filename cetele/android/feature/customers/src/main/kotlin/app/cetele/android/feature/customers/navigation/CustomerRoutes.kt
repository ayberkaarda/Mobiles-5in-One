package app.cetele.android.feature.customers.navigation

import kotlinx.serialization.Serializable

object CustomerRoutes {
    @Serializable
    data object List

    @Serializable
    data class Edit(
        val customerId: String? = null,
    )

    @Serializable
    data class Detail(
        val customerId: String,
    )
}
