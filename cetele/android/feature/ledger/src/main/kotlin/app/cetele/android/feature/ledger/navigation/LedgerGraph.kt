package app.cetele.android.feature.ledger.navigation

import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import app.cetele.android.feature.ledger.dashboard.DashboardRoute
import app.cetele.android.feature.ledger.entry.EntryDetailRoute
import app.cetele.android.feature.ledger.entry.EntryEditRoute

fun NavGraphBuilder.ledgerGraph(nav: LedgerNavigation) {
    composable<LedgerRoutes.Entry> {
        EntryEditRoute(onBack = nav::onBack)
    }
    composable<LedgerRoutes.EntryDetail> {
        EntryDetailRoute(onBack = nav::onBack, onEntrySelected = nav::onEntrySelected)
    }
    composable<LedgerRoutes.Dashboard> {
        DashboardRoute(
            onCustomerSelected = nav::onCustomerSelected,
            onRemind = nav::onRemind,
            onRequestSync = nav::onRequestSync,
        )
    }
}
