package app.cetele.android.feature.ledger.navigation

interface LedgerNavigation {
    fun onBack()

    fun onEntrySelected(entryId: String)

    fun onCustomerSelected(customerId: String)

    fun onRemind(customerId: String)

    fun onRequestSync(shopId: String)
}
