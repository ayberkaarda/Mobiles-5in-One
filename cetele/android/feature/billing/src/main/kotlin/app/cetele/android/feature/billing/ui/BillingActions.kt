package app.cetele.android.feature.billing.ui

import app.cetele.android.feature.billing.gateway.ProOffer

/** Callbacks of the billing screen; the purchase sheet needs the activity, which the graph supplies. */
internal class BillingActions(
    val onSubscribe: (ProOffer) -> Unit,
    val onRestore: () -> Unit,
    val onManage: () -> Unit,
    val onReload: () -> Unit,
    val onDismissNotice: () -> Unit,
    val onBack: () -> Unit,
)
