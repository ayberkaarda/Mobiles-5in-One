package app.cetele.android.feature.ledger.navigation

interface LedgerNavigation {
    fun onBack()

    fun onEntrySelected(entryId: String)

    fun onCustomerSelected(customerId: String)

    fun onRemind(customerId: String)

    fun onRequestSync(shopId: String)

    /** Opens the Çetele Pro screen after `plan.photo_limit` (owner only); `null` hides the button. */
    val onOpenBilling: (() -> Unit)?
        get() = null
}
