package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.ShopRole
import java.time.Instant
import java.time.LocalDate

@Preview(locale = "tr", showBackground = true)
@Composable
private fun ControlsPreview() {
    CeteleTheme {
        Surface {
            Column(verticalArrangement = Arrangement.spacedBy(CeteleSpacing.small)) {
                CeteleTopBar(stringResource(R.string.designsystem_preview_title), onBack = {})
                ButtonStyle.entries.forEach { style ->
                    CeteleButton(stringResource(R.string.action_save), {}, style = style)
                }
                CeteleButton(stringResource(R.string.action_save), {}, loading = true)
                CeteleFab(stringResource(R.string.action_add_customer), CeteleIcons.add, {})
                CeteleTextField("", {}, stringResource(R.string.designsystem_preview_name))
                PhoneTextField("", {})
            }
        }
    }
}

@Preview(locale = "tr", showBackground = true)
@Preview(locale = "tr", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun RowsPreview() {
    CeteleTheme {
        Surface {
            Column {
                SectionHeader(stringResource(R.string.designsystem_preview_title))
                BalanceBand(Money(PREVIEW_DEBT_MINOR))
                CustomerRow(stringResource(R.string.designsystem_preview_name), Money(-PREVIEW_CREDIT_MINOR), {})
                LedgerRow(previewEntry(), {})
                LedgerRow(previewEntry().copy(reversedBy = "sample-correction"), {})
                RoleGate(ShopRole.OWNER, requires = ShopRole.OWNER) {
                    CeteleButton(stringResource(R.string.action_correct), {})
                }
            }
        }
    }
}

@Preview(locale = "tr", showBackground = true)
@Composable
private fun MessagesPreview() {
    CeteleTheme {
        Surface {
            Column(verticalArrangement = Arrangement.spacedBy(CeteleSpacing.small)) {
                SectionHeader(stringResource(R.string.designsystem_preview_title))
                BannerKind.entries.forEach { kind ->
                    StatusBanner(kind, stringResource(R.string.offline_banner))
                }
                SyncStatusChip(SyncStatusSummary(pendingCount = 3))
                SyncStatusChip(SyncStatusSummary(blockedCount = 1))
                EmptyState(
                    CeteleIcons.info,
                    stringResource(R.string.designsystem_preview_empty),
                    stringResource(R.string.designsystem_preview_empty_text),
                    action = { CeteleButton(stringResource(R.string.action_add_customer), {}) },
                )
            }
        }
    }
}

@Preview(locale = "tr", showBackground = true)
@Composable
private fun AmountKeypadPreview() {
    CeteleTheme {
        Surface {
            var value by remember { mutableStateOf(0L) }
            Column {
                SectionHeader(stringResource(R.string.designsystem_preview_title))
                AmountText(Money(value), style = AmountStyle.Large)
                AmountKeypad(value, { value = it }, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Preview(locale = "tr", showBackground = true)
@Composable
private fun PinPadPreview() {
    CeteleTheme {
        Surface {
            PinPad(onComplete = {}, subtitle = stringResource(R.string.designsystem_preview_title))
        }
    }
}

@Preview(locale = "tr", showBackground = true)
@Composable
private fun ConfirmationPreview() {
    CeteleTheme {
        ConfirmSheet(
            title = stringResource(R.string.designsystem_preview_title),
            text = stringResource(R.string.designsystem_preview_confirmation),
            confirmText = stringResource(R.string.action_correct),
            destructive = true,
            onConfirm = {},
            onDismiss = {},
        )
    }
}

private const val PREVIEW_DEBT_MINOR = 125_000L
private const val PREVIEW_CREDIT_MINOR = 1_200L
private const val PREVIEW_YEAR = 2026
private const val PREVIEW_MONTH = 10
private const val PREVIEW_DAY = 6

private fun previewEntry(): LedgerEntry =
    LedgerEntry(
        id = "sample-entry",
        shopId = "sample-shop",
        customerId = "sample-customer",
        type = EntryType.DEBT,
        amount = Money(PREVIEW_DEBT_MINOR),
        occurredOn = LocalDate.of(PREVIEW_YEAR, PREVIEW_MONTH, PREVIEW_DAY),
        dueOn = null,
        note = null,
        photoKey = null,
        reverses = null,
        reversedBy = null,
        createdBy = null,
        createdAt = Instant.parse("2026-10-06T09:00:00Z"),
    )
