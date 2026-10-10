package app.cetele.android.feature.customers.list

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.BannerKind
import app.cetele.android.core.designsystem.component.CeteleFab
import app.cetele.android.core.designsystem.component.CeteleTextField
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.CustomerRow
import app.cetele.android.core.designsystem.component.EmptyState
import app.cetele.android.core.designsystem.component.StatusBanner
import app.cetele.android.core.designsystem.component.SyncStatusSummary
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.feature.customers.R

@Composable
fun CustomerListScreen(
    state: CustomerListState,
    onSearch: (String) -> Unit,
    onCustomerSelected: (String) -> Unit,
    onAddCustomer: () -> Unit,
    modifier: Modifier = Modifier,
    syncStatus: SyncStatusSummary = SyncStatusSummary(),
    customerLimitRejected: Boolean = false,
) {
    Scaffold(
        modifier = modifier,
        topBar = { CeteleTopBar(stringResource(R.string.customers_list_title)) },
        floatingActionButton = {
            if (state.shop != null) {
                CeteleFab(stringResource(R.string.customers_list_add), CeteleIcons.add, onAddCustomer)
            }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.small),
        ) {
            CeteleTextField(
                state.query,
                onSearch,
                stringResource(R.string.customers_list_search),
                modifier = Modifier.fillMaxWidth().padding(horizontal = CeteleSpacing.screenGutter),
            )
            if (syncStatus.offline) {
                StatusBanner(BannerKind.Offline, stringResource(R.string.customers_list_offline))
            }
            if (customerLimitRejected && state.shop?.plan == ShopPlan.FREE) {
                StatusBanner(BannerKind.Warning, stringResource(R.string.customers_list_limit))
            }
            CustomerResults(state, onCustomerSelected, Modifier.weight(1f))
        }
    }
}

@Composable
private fun CustomerResults(
    state: CustomerListState,
    onCustomerSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    when {
        state.loading -> {
            CircularProgressIndicator()
        }

        state.customers.isEmpty() -> {
            val title = if (state.query.isBlank()) R.string.customers_list_empty else R.string.customers_list_no_results
            val body =
                if (state.query.isBlank()) {
                    R.string.customers_list_empty_body
                } else {
                    R.string.customers_list_search_body
                }
            EmptyState(CeteleIcons.info, stringResource(title), stringResource(body), modifier = modifier)
        }

        else -> {
            LazyColumn(modifier) {
                items(state.customers, key = { it.customer.id }) { row ->
                    CustomerRow(
                        name = row.customer.name,
                        balance = row.balance,
                        onClick = { onCustomerSelected(row.customer.id) },
                        phone = row.customer.phone,
                        tag = row.customer.tag,
                    )
                }
                item { Spacer(Modifier.height(CeteleSpacing.fabSize)) }
            }
        }
    }
}
