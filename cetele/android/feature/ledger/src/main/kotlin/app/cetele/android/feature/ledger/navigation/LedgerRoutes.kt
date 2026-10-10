package app.cetele.android.feature.ledger.navigation

import app.cetele.android.core.domain.model.EntryType
import kotlinx.serialization.Serializable

object LedgerRoutes {
    /** The entry type travels as its name so minified builds need no keep rule for the domain enum. */
    @Serializable
    data class Entry(
        val customerId: String,
        val type: String,
    ) {
        constructor(customerId: String, type: EntryType) : this(customerId, type.name)
    }

    @Serializable
    data class EntryDetail(
        val entryId: String,
    )

    @Serializable
    data object Dashboard
}
