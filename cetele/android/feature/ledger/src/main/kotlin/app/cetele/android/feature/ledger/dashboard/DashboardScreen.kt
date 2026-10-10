package app.cetele.android.feature.ledger.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.component.AmountStyle
import app.cetele.android.core.designsystem.component.AmountText
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.CustomerRow
import app.cetele.android.core.designsystem.component.SectionHeader
import app.cetele.android.core.domain.format.MoneyFormat
import app.cetele.android.core.domain.ledger.DashboardSummary
import app.cetele.android.feature.ledger.R
import app.cetele.android.core.designsystem.R as DesignR

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    state: DashboardState,
    onCustomerSelected: (String) -> Unit,
    onRemind: (String) -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    refreshing: Boolean = false,
) {
    Scaffold(
        modifier = modifier,
        topBar = { CeteleTopBar(stringResource(R.string.ledger_dashboard_title)) },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = onRefresh,
            modifier = Modifier.padding(padding).fillMaxSize().then(refreshingSemantics(refreshing)),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
            ) {
                val summary = state.summary
                if (summary == null) {
                    item {
                        val message =
                            if (state.loading) R.string.ledger_detail_loading else R.string.ledger_dashboard_no_shop
                        Text(
                            stringResource(message),
                            modifier = Modifier.padding(CeteleSpacing.screenGutter),
                        )
                    }
                } else {
                    summaryItems(summary, onCustomerSelected, onRemind)
                }
            }
        }
    }
}

private fun LazyListScope.summaryItems(
    summary: DashboardSummary,
    onCustomerSelected: (String) -> Unit,
    onRemind: (String) -> Unit,
) {
    item {
        Column(modifier = Modifier.padding(CeteleSpacing.screenGutter)) {
            Text(
                stringResource(
                    R.string.ledger_dashboard_today,
                    MoneyFormat.format(summary.todayDebt.minor),
                    MoneyFormat.format(summary.todayPayment.minor),
                ),
                style = CeteleTextStyles.amount,
            )
            SectionHeader(stringResource(R.string.ledger_dashboard_total))
            AmountText(summary.totalReceivable, style = AmountStyle.Large)
        }
    }
    item { SectionHeader(stringResource(R.string.ledger_dashboard_top), Modifier.padding(CeteleSpacing.screenGutter)) }
    if (summary.topDebtors.isEmpty()) {
        item { Text(stringResource(R.string.ledger_dashboard_no_debt), Modifier.padding(CeteleSpacing.screenGutter)) }
    }
    items(summary.topDebtors, key = { "debtor-${it.customerId}" }) { debtor ->
        CustomerRow(debtor.name, debtor.balance, { onCustomerSelected(debtor.customerId) })
    }
    item { SectionHeader(stringResource(R.string.ledger_dashboard_due), Modifier.padding(CeteleSpacing.screenGutter)) }
    if (summary.dueToday.isEmpty()) {
        item { Text(stringResource(R.string.ledger_dashboard_no_due), Modifier.padding(CeteleSpacing.screenGutter)) }
    }
    items(summary.dueToday, key = { "due-${it.entry.id}" }) { due ->
        Column(modifier = Modifier.padding(CeteleSpacing.screenGutter)) {
            CustomerRow(due.customerName, due.balance, { onCustomerSelected(due.entry.customerId) })
            Row(horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.regular)) {
                Text(stringResource(R.string.ledger_dashboard_due_amount), style = CeteleTextStyles.body)
                AmountText(due.entry.amount)
            }
            CeteleButton(
                stringResource(DesignR.string.action_remind),
                { onRemind(due.entry.customerId) },
                style = ButtonStyle.Outlined,
            )
        }
    }
}

/** Announces the running sync to screen readers; nothing is added while idle. */
@Composable
private fun refreshingSemantics(refreshing: Boolean): Modifier {
    if (!refreshing) return Modifier
    val description = stringResource(R.string.ledger_dashboard_refreshing)
    return Modifier.semantics { stateDescription = description }
}
