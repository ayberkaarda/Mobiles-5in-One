package app.cetele.android.feature.ledger.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.component.AmountText
import app.cetele.android.core.designsystem.component.AmountTone
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.CoverRule
import app.cetele.android.core.designsystem.component.CustomerRow
import app.cetele.android.core.designsystem.component.LedgerCover
import app.cetele.android.core.designsystem.component.SectionHeader
import app.cetele.android.core.designsystem.component.Sheet
import app.cetele.android.core.designsystem.component.SheetItem
import app.cetele.android.core.domain.format.MoneyFormat
import app.cetele.android.core.domain.ledger.DashboardSummary
import app.cetele.android.core.domain.ledger.DueLine
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
        containerColor = CeteleTheme.colors.background,
        topBar = { CeteleTopBar(stringResource(R.string.ledger_dashboard_title)) },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = onRefresh,
            modifier = Modifier.padding(padding).fillMaxSize().then(refreshingSemantics(refreshing)),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = CeteleSpacing.spacious),
            ) {
                val summary = state.summary
                if (summary == null) {
                    item {
                        val message =
                            if (state.loading) R.string.ledger_detail_loading else R.string.ledger_dashboard_no_shop
                        Text(
                            stringResource(message),
                            modifier = Modifier.padding(CeteleSpacing.screenGutter),
                            style = CeteleTextStyles.body,
                            color = CeteleTheme.colors.textMuted,
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
    item(key = "total") {
        LedgerCover(
            label = stringResource(R.string.ledger_dashboard_total),
            amount = summary.totalReceivable,
            modifier = Modifier.padding(horizontal = CeteleSpacing.screenGutter),
        ) {
            CoverRule()
            Text(
                stringResource(
                    R.string.ledger_dashboard_today,
                    MoneyFormat.format(summary.todayDebt.minor),
                    MoneyFormat.format(summary.todayPayment.minor),
                ),
                style = CeteleTextStyles.body,
                color = CeteleTheme.cover.contentMuted,
            )
        }
    }
    item(key = "top-title") { SectionHeader(stringResource(R.string.ledger_dashboard_top)) }
    if (summary.topDebtors.isEmpty()) {
        item(key = "top-empty") { QuietLine(stringResource(R.string.ledger_dashboard_no_debt)) }
    }
    val debtors = summary.topDebtors.size
    itemsIndexed(summary.topDebtors, key = { _, debtor -> "debtor-${debtor.customerId}" }) { index, debtor ->
        SheetItem(index, debtors, ruleInset = CeteleSpacing.listRuleInset) {
            CustomerRow(debtor.name, debtor.balance, { onCustomerSelected(debtor.customerId) })
        }
    }
    item(key = "due-title") { SectionHeader(stringResource(R.string.ledger_dashboard_due)) }
    if (summary.dueToday.isEmpty()) {
        item(key = "due-empty") { QuietLine(stringResource(R.string.ledger_dashboard_no_due)) }
    }
    val due = summary.dueToday.size
    itemsIndexed(summary.dueToday, key = { _, item -> "due-${item.entry.id}" }) { index, item ->
        SheetItem(index, due, ruleInset = CeteleSpacing.listRuleInset) {
            DueRow(item, onCustomerSelected, onRemind)
        }
    }
}

/** A customer whose entry is due today: the row, the due amount and the reminder action. */
@Composable
private fun DueRow(
    item: DueLine,
    onCustomerSelected: (String) -> Unit,
    onRemind: (String) -> Unit,
) {
    Column {
        CustomerRow(item.customerName, item.balance, { onCustomerSelected(item.entry.customerId) })
        Row(
            modifier =
                Modifier.fillMaxWidth().padding(
                    start = CeteleSpacing.listRuleInset,
                    end = CeteleSpacing.regular,
                    bottom = CeteleSpacing.medium,
                ),
            horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.ledger_dashboard_due_amount),
                    style = CeteleTextStyles.caption,
                    color = CeteleTheme.colors.textMuted,
                )
                AmountText(item.entry.amount, tone = AmountTone.Debt)
            }
            CeteleButton(
                stringResource(DesignR.string.action_remind),
                { onRemind(item.entry.customerId) },
                icon = CeteleIcons.remind,
                style = ButtonStyle.Tonal,
            )
        }
    }
}

/** A one-line note in a sheet, for an empty section. */
@Composable
private fun QuietLine(text: String) {
    Sheet {
        Text(
            text,
            modifier = Modifier.padding(CeteleSpacing.regular),
            style = CeteleTextStyles.body,
            color = CeteleTheme.colors.textMuted,
        )
    }
}

/** Announces the running sync to screen readers; nothing is added while idle. */
@Composable
private fun refreshingSemantics(refreshing: Boolean): Modifier {
    if (!refreshing) return Modifier
    val description = stringResource(R.string.ledger_dashboard_refreshing)
    return Modifier.semantics { stateDescription = description }
}
