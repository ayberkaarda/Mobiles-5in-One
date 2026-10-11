package app.cetele.android.feature.customers.navigation

import app.cetele.android.core.designsystem.component.SyncStatusSummary
import app.cetele.android.core.domain.model.EntryType
import kotlinx.coroutines.flow.Flow

interface CustomerNavigation {
    val syncStatus: Flow<SyncStatusSummary>
    val customerLimitRejected: Flow<Boolean>

    /** Opens the Çetele Pro screen from the customer limit banner (owner only); `null` hides the button. */
    val onOpenBilling: (() -> Unit)?
        get() = null

    fun onCustomerSelected(customerId: String)

    fun onAddCustomer()

    fun onEditCustomer(customerId: String)

    fun onCustomerSaved(customerId: String)

    fun onCustomerDeleted()

    fun onAddEntry(
        customerId: String,
        type: EntryType,
    )

    fun onEntrySelected(entryId: String)

    fun onRemind(customerId: String)

    fun onExport(customerId: String)

    fun onBack()
}
