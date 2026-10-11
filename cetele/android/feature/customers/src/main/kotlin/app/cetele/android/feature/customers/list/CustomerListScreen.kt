package app.cetele.android.feature.customers.list

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.component.BannerKind
import app.cetele.android.core.designsystem.component.CeteleFab
import app.cetele.android.core.designsystem.component.CeteleTextField
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.CustomerRow
import app.cetele.android.core.designsystem.component.EmptyState
import app.cetele.android.core.designsystem.component.PlanUpgradeAction
import app.cetele.android.core.designsystem.component.SheetItem
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
    onUpgrade: (() -> Unit)? = null,
) {
    Scaffold(
        modifier = modifier,
        containerColor = CeteleTheme.colors.background,
        topBar = { CeteleTopBar(stringResource(R.string.customers_list_title)) },
        floatingActionButton = {
            if (state.shop != null) {
                CeteleFab(stringResource(R.string.customers_list_add), CeteleIcons.add, onAddCustomer)
            }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.medium),
        ) {
            CeteleTextField(
                state.query,
                onSearch,
                stringResource(R.string.customers_list_search),
                modifier = Modifier.fillMaxWidth().padding(horizontal = CeteleSpacing.screenGutter),
                leadingIcon = CeteleIcons.search,
            )
            if (syncStatus.offline) {
                StatusBanner(BannerKind.Offline, stringResource(R.string.customers_list_offline))
            }
            if (customerLimitRejected && state.shop?.plan == ShopPlan.FREE) {
                StatusBanner(BannerKind.Warning, stringResource(R.string.customers_list_limit)) {
                    PlanUpgradeAction(state.shop, onUpgrade)
                }
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
            Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                CircularProgressIndicator(
                    modifier = Modifier.padding(CeteleSpacing.spacious),
                    color = CeteleTheme.colors.primary,
                )
            }
        }

        state.customers.isEmpty() -> {
            val title = if (state.query.isBlank()) R.string.customers_list_empty else R.string.customers_list_no_results
            val body =
                if (state.query.isBlank()) {
                    R.string.customers_list_empty_body
                } else {
                    R.string.customers_list_search_body
                }
            val icon = if (state.query.isBlank()) CeteleIcons.customers else CeteleIcons.search
            EmptyState(icon, stringResource(title), stringResource(body), modifier = modifier)
        }

        else -> {
            val count = state.customers.size
            LazyColumn(modifier, contentPadding = PaddingValues(top = CeteleSpacing.extraSmall)) {
                itemsIndexed(state.customers, key = { _, row -> row.customer.id }) { index, row ->
                    SheetItem(index, count, ruleInset = CeteleSpacing.listRuleInset) {
                        CustomerRow(
                            name = row.customer.name,
                            balance = row.balance,
                            onClick = { onCustomerSelected(row.customer.id) },
                            phone = row.customer.phone,
                            tag = row.customer.tag,
                        )
                    }
                }
                item { Spacer(Modifier.height(CeteleSpacing.fabSize + CeteleSpacing.spacious)) }
            }
        }
    }
}
