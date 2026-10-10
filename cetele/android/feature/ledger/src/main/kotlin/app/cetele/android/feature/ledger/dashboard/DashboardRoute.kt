package app.cetele.android.feature.ledger.dashboard

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun DashboardRoute(
    onCustomerSelected: (String) -> Unit,
    onRemind: (String) -> Unit,
    onRequestSync: (String) -> Unit,
    modifier: Modifier = Modifier,
    refreshing: Boolean = false,
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val requestSync by rememberUpdatedState(onRequestSync)
    LaunchedEffect(viewModel) {
        viewModel.refreshes.collect { shopId -> requestSync(shopId) }
    }
    DashboardScreen(
        state,
        onCustomerSelected,
        onRemind,
        viewModel::refresh,
        modifier = modifier,
        refreshing = refreshing,
    )
}
