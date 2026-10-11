package app.cetele.android.feature.customers.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.component.BalanceBand
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.ConfirmSheet
import app.cetele.android.core.designsystem.component.EmptyState
import app.cetele.android.core.designsystem.component.LedgerRow
import app.cetele.android.core.designsystem.component.ProblemBanner
import app.cetele.android.core.designsystem.component.RoleGate
import app.cetele.android.core.designsystem.component.SheetItem
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.feature.customers.R

@Composable
fun CustomerDetailScreen(
    state: CustomerDetailState,
    onAddEntry: (EntryType) -> Unit,
    onEntrySelected: (String) -> Unit,
    onRemind: () -> Unit,
    onExport: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menuVisible by remember(state.customer?.id) { mutableStateOf(false) }
    var confirmVisible by remember(state.customer?.id) { mutableStateOf(false) }
    Scaffold(
        modifier = modifier,
        containerColor = CeteleTheme.colors.background,
        topBar = {
            DetailTopBar(
                state,
                menuVisible,
                { menuVisible = it },
                onBack,
                {
                    menuVisible = false
                    onEdit()
                },
                {
                    menuVisible = false
                    confirmVisible = true
                },
            )
        },
    ) { padding ->
        DetailContent(
            state,
            onAddEntry,
            onEntrySelected,
            onRemind,
            onExport,
            Modifier.fillMaxSize().padding(padding),
        )
    }
    if (confirmVisible && state.canConfirmDelete()) {
        ConfirmSheet(
            stringResource(R.string.customers_detail_delete),
            stringResource(R.string.customers_detail_delete_body),
            stringResource(R.string.customers_detail_delete_confirm),
            destructive = true,
            onConfirm = {
                confirmVisible = false
                onDelete()
            },
            onDismiss = { if (!state.deleting) confirmVisible = false },
            loading = state.deleting,
        )
    }
}

private fun CustomerDetailState.canConfirmDelete(): Boolean = role == ShopRole.OWNER && customer != null && !deleted

@Composable
private fun DetailContent(
    state: CustomerDetailState,
    onAddEntry: (EntryType) -> Unit,
    onEntrySelected: (String) -> Unit,
    onRemind: () -> Unit,
    onExport: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        if (state.loading) {
            LinearProgressIndicator(Modifier.fillMaxWidth(), color = CeteleTheme.colors.primary)
        }
        state.problemCode?.let { ProblemBanner(it) }
        if (state.customer != null && !state.deleted) {
            val count = state.rows.size
            LazyColumn(
                Modifier.weight(1f).testTag("customer-statement"),
                contentPadding = PaddingValues(bottom = CeteleSpacing.spacious),
            ) {
                item(key = "balance") {
                    BalanceBand(
                        state.balance,
                        modifier = Modifier.padding(horizontal = CeteleSpacing.screenGutter),
                    ) {
                        EntryActions(onAddEntry, !state.deleting)
                    }
                }
                item(key = "actions") { CustomerActions(onRemind, onExport, !state.deleting) }
                if (state.rows.isEmpty()) {
                    item(key = "empty") {
                        EmptyState(
                            CeteleIcons.today,
                            stringResource(R.string.customers_detail_empty),
                            stringResource(R.string.customers_detail_empty_body),
                        )
                    }
                } else {
                    itemsIndexed(state.rows, key = { _, row -> row.entry.id }) { index, row ->
                        SheetItem(index, count, ruleInset = CeteleSpacing.entryRuleInset) {
                            LedgerRow(row.entry, { onEntrySelected(row.entry.id) }, struck = row.struck)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailTopBar(
    state: CustomerDetailState,
    menuVisible: Boolean,
    onMenu: (Boolean) -> Unit,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    CeteleTopBar(
        state.customer?.name ?: stringResource(R.string.customers_detail_title),
        onBack = onBack,
        actions = {
            if (state.customer != null && !state.deleted) {
                TextButton(onClick = { onMenu(true) }, enabled = !state.deleting) {
                    Text(stringResource(R.string.customers_detail_more))
                }
                DropdownMenu(expanded = menuVisible, onDismissRequest = { onMenu(false) }) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.customers_detail_edit)) },
                        onClick = onEdit,
                    )
                    RoleGate(state.role, ShopRole.OWNER) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.customers_detail_delete)) },
                            onClick = onDelete,
                        )
                    }
                }
            }
        },
    )
}

/** The two ledger actions, on the cover under the balance: the orange one writes debt. */
@Composable
private fun EntryActions(
    onAddEntry: (EntryType) -> Unit,
    enabled: Boolean,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small)) {
        CeteleButton(
            stringResource(R.string.customers_detail_debt),
            { onAddEntry(EntryType.DEBT) },
            modifier = Modifier.weight(1f),
            style = ButtonStyle.Accent,
            enabled = enabled,
            icon = painterResource(CeteleIcons.debt),
        )
        CeteleButton(
            stringResource(R.string.customers_detail_payment),
            { onAddEntry(EntryType.PAYMENT) },
            modifier = Modifier.weight(1f),
            style = ButtonStyle.OnCover,
            enabled = enabled,
            icon = painterResource(CeteleIcons.payment),
        )
    }
}

/** Reminder and statement: quieter, on the page under the cover. */
@Composable
private fun CustomerActions(
    onRemind: () -> Unit,
    onExport: () -> Unit,
    enabled: Boolean,
) {
    Row(
        Modifier.padding(
            start = CeteleSpacing.screenGutter,
            end = CeteleSpacing.screenGutter,
            top = CeteleSpacing.medium,
            bottom = CeteleSpacing.regular,
        ),
        horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small),
    ) {
        CeteleButton(
            stringResource(R.string.customers_detail_remind),
            onRemind,
            icon = CeteleIcons.remind,
            modifier = Modifier.weight(1f),
            style = ButtonStyle.Quiet,
            enabled = enabled,
        )
        CeteleButton(
            stringResource(R.string.customers_detail_statement),
            onExport,
            icon = CeteleIcons.statement,
            modifier = Modifier.weight(1f),
            style = ButtonStyle.Quiet,
            enabled = enabled,
        )
    }
}
