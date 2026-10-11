package app.cetele.android.feature.export.backup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import app.cetele.android.core.data.backup.BackupPreview
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.component.BannerKind
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.CeteleTextField
import app.cetele.android.core.designsystem.component.CeteleTopBar
import app.cetele.android.core.designsystem.component.SectionHeader
import app.cetele.android.core.designsystem.component.StatusBanner
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.feature.export.R
import app.cetele.android.core.designsystem.R as DesignR

@Composable
fun BackupExportScreen(
    state: BackupUiState,
    onSelect: (String) -> Unit,
    onExport: (passphrase: String, confirm: String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Plain remember: the passphrase never goes into saved instance state.
    var passphrase by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    BackupScaffold(R.string.export_backup_title, onBack, modifier) {
        when {
            state.loading -> {
                Text(stringResource(R.string.export_common_loading))
            }

            state.shops.isEmpty() -> {
                Text(stringResource(R.string.export_backup_owner_only), style = CeteleTextStyles.body)
            }

            else -> {
                Text(stringResource(R.string.export_backup_intro), style = CeteleTextStyles.body)
                ShopChoices(state.shops, state.selectedShopId, onSelect, enabled = !state.busy)
                PassphraseField(passphrase, { passphrase = it }, R.string.export_backup_passphrase, !state.busy)
                PassphraseField(
                    confirm,
                    { confirm = it },
                    R.string.export_backup_passphrase_again,
                    !state.busy,
                    error = state.passphraseError?.let { stringResource(it) },
                )
                Text(stringResource(R.string.export_backup_passphrase_hint), style = CeteleTextStyles.caption)
                CeteleButton(
                    stringResource(R.string.export_backup_create),
                    { onExport(passphrase, confirm) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = state.selectedShopId != null,
                    loading = state.busy,
                )
                state.exported?.let {
                    StatusBanner(
                        BannerKind.Info,
                        stringResource(R.string.export_backup_ready, it.customers, it.entries),
                    )
                }
                ErrorText(state.errorRes)
            }
        }
    }
}

@Composable
fun BackupImportScreen(
    state: BackupUiState,
    onPick: () -> Unit,
    onOpen: (passphrase: String) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var passphrase by remember(state.fileLoaded) { mutableStateOf("") }
    BackupScaffold(R.string.export_restore_title, onBack, modifier) {
        val preview = state.preview
        val imported = state.imported
        when {
            state.loading -> {
                Text(stringResource(R.string.export_common_loading))
            }

            state.shops.isEmpty() -> {
                Text(stringResource(R.string.export_backup_owner_only), style = CeteleTextStyles.body)
            }

            imported != null -> {
                StatusBanner(
                    BannerKind.Info,
                    stringResource(R.string.export_restore_done, imported.addedCustomers, imported.addedEntries),
                )
                CeteleButton(stringResource(R.string.export_restore_finish), onBack, Modifier.fillMaxWidth())
            }

            preview != null -> {
                PreviewSummary(preview)
                CeteleButton(
                    stringResource(R.string.export_restore_confirm),
                    onConfirm,
                    Modifier.fillMaxWidth(),
                    loading = state.busy,
                )
                CancelButton(onCancel, !state.busy)
            }

            state.fileLoaded -> {
                Text(stringResource(R.string.export_restore_file_ready), style = CeteleTextStyles.body)
                PassphraseField(passphrase, { passphrase = it }, R.string.export_backup_passphrase, !state.busy)
                CeteleButton(
                    stringResource(R.string.export_restore_open),
                    { onOpen(passphrase) },
                    Modifier.fillMaxWidth(),
                    enabled = passphrase.isNotEmpty(),
                    loading = state.busy,
                )
                CancelButton(onCancel, !state.busy)
            }

            else -> {
                Text(stringResource(R.string.export_restore_intro), style = CeteleTextStyles.body)
                CeteleButton(
                    stringResource(R.string.export_restore_pick),
                    onPick,
                    Modifier.fillMaxWidth(),
                    loading = state.busy,
                )
            }
        }
        if (state.shops.isNotEmpty() && imported == null) ErrorText(state.errorRes)
    }
}

@Composable
private fun PreviewSummary(preview: BackupPreview) {
    SectionHeader(preview.shopName)
    Text(
        stringResource(
            R.string.export_restore_date,
            DateFormats.long(preview.exportedAt.atZone(CeteleClock.ZONE).toLocalDate()),
        ),
    )
    Text(stringResource(R.string.export_restore_summary, preview.customers, preview.entries))
    Text(
        stringResource(R.string.export_restore_new, preview.newCustomers, preview.newEntries),
        style = CeteleTextStyles.bodyStrong,
    )
}

@Composable
private fun BackupScaffold(
    title: Int,
    onBack: () -> Unit,
    modifier: Modifier,
    content: @Composable () -> Unit,
) {
    Scaffold(
        modifier = modifier,
        topBar = { CeteleTopBar(stringResource(title), onBack = onBack) },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .padding(padding)
                    .padding(CeteleSpacing.screenGutter)
                    .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.large),
        ) {
            content()
        }
    }
}

@Composable
private fun ShopChoices(
    shops: List<Shop>,
    selected: String?,
    onSelect: (String) -> Unit,
    enabled: Boolean,
) {
    Column(Modifier.selectableGroup()) {
        Text(stringResource(R.string.export_backup_shop), style = CeteleTextStyles.label)
        for (shop in shops) {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = CeteleSpacing.touchTarget)
                        .selectable(
                            selected = shop.id == selected,
                            enabled = enabled,
                            role = Role.RadioButton,
                            onClick = { onSelect(shop.id) },
                        ),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small),
            ) {
                RadioButton(selected = shop.id == selected, onClick = null, enabled = enabled)
                Text(shop.name, style = CeteleTextStyles.body)
            }
        }
    }
}

@Composable
private fun PassphraseField(
    value: String,
    onValueChange: (String) -> Unit,
    label: Int,
    enabled: Boolean,
    error: String? = null,
) {
    CeteleTextField(
        value = value,
        onValueChange = onValueChange,
        label = stringResource(label),
        modifier = Modifier.fillMaxWidth(),
        error = error,
        keyboard = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
        enabled = enabled,
        visualTransformation = PasswordVisualTransformation(),
    )
}

@Composable
private fun CancelButton(
    onCancel: () -> Unit,
    enabled: Boolean,
) {
    CeteleButton(
        stringResource(DesignR.string.action_cancel),
        onCancel,
        Modifier.fillMaxWidth(),
        style = ButtonStyle.Text,
        enabled = enabled,
    )
}

@Composable
private fun ErrorText(errorRes: Int?) {
    errorRes?.let {
        Text(
            stringResource(it),
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            color = CeteleTheme.colors.errorText,
            style = CeteleTextStyles.body,
        )
    }
}
