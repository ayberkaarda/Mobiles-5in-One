package app.cetele.android.feature.export

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.component.BalanceBand
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.RoleGate
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.time.CeteleClock

@Composable
fun ExportStatementScreen(
    snapshot: ExportSnapshot,
    action: ExportActionState,
    onShare: () -> Unit,
    onDownload: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        topBar = { CeteleTopBar(stringResource(R.string.export_statement_title), onBack = onBack) },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .padding(padding)
                    .padding(CeteleSpacing.screenGutter)
                    .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.large),
        ) {
            when {
                snapshot.loading -> {
                    Text(stringResource(R.string.export_common_loading))
                }

                !snapshot.available || snapshot.customer == null || snapshot.shop == null -> {
                    Text(stringResource(R.string.export_common_unavailable))
                }

                else -> {
                    Text(snapshot.shop.name)
                    Text(snapshot.customer.name)
                    Text(
                        stringResource(
                            R.string.export_statement_count,
                            snapshot.rows.size,
                            DateFormats.long(CeteleClock.today()),
                        ),
                    )
                    BalanceBand(snapshot.rows.lastOrNull()?.runningBalance ?: Money.ZERO)
                    CeteleButton(stringResource(R.string.export_common_share), onShare, loading = action.busy)
                    ExportError(action)
                    if (action.fontsUnavailable) {
                        CeteleButton(
                            stringResource(R.string.export_statement_download),
                            onDownload,
                            loading = action.busy,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ExportAllScreen(
    snapshot: ExportSnapshot,
    action: ExportActionState,
    onShare: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        topBar = { CeteleTopBar(stringResource(R.string.export_all_title), onBack = onBack) },
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).padding(CeteleSpacing.screenGutter),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.large),
        ) {
            RoleGate(snapshot.shop?.role, ShopRole.OWNER) {
                Text(snapshot.shop?.name.orEmpty())
                when {
                    snapshot.loading -> Text(stringResource(R.string.export_common_loading))
                    snapshot.available -> Text(stringResource(R.string.export_all_count, snapshot.csvRows.size))
                    else -> Text(stringResource(R.string.export_common_unavailable))
                }
                CeteleButton(
                    stringResource(R.string.export_all_share),
                    onShare,
                    enabled = !snapshot.loading && snapshot.available,
                    loading = action.busy,
                )
                ExportError(action)
            }
        }
    }
}

@Composable
private fun ExportError(action: ExportActionState) {
    action.errorRes?.let { Text(stringResource(it)) }
    action.traceId?.let {
        Text(stringResource(R.string.export_common_support, it), style = CeteleTextStyles.caption)
    }
}
