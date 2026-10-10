package app.cetele.android.feature.settings.account

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.common.ReauthField
import app.cetele.android.feature.settings.common.SettingsErrorText
import app.cetele.android.feature.settings.common.SettingsPage

@Composable
internal fun AccountDeletionScreen(
    state: AccountDeletionState,
    onRequestCode: () -> Unit,
    onDelete: (String, Boolean) -> Unit,
    onTransfer: () -> Unit,
    onDismissChoice: () -> Unit,
    onBack: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    var deleteOwnedShops by remember { mutableStateOf(false) }
    SettingsPage(stringResource(R.string.settings_home_account_deletion), onBack) {
        Text(stringResource(R.string.settings_deletion_explanation))
        if (state.receipt != null) {
            Text(stringResource(R.string.settings_deletion_scheduled))
            CeteleButton(stringResource(R.string.settings_common_back), onBack)
        } else {
            CeteleButton(stringResource(R.string.settings_deletion_send_code), {
                code = ""
                onRequestCode()
            }, enabled = !state.busy)
            if (state.codeSent) {
                ReauthField(code, { code = it }, !state.busy)
                CeteleButton(
                    stringResource(
                        if (deleteOwnedShops) {
                            R.string.settings_deletion_delete_shops
                        } else {
                            R.string.settings_home_account_deletion
                        },
                    ),
                    {
                        onDelete(code, deleteOwnedShops)
                        code = ""
                    },
                    enabled = !state.busy && validCode(code),
                )
            }
        }
        SettingsErrorText(state.error)
    }
    if (state.sharedShopChoice) {
        AlertDialog(
            onDismissRequest = onDismissChoice,
            title = { Text(stringResource(R.string.settings_deletion_shared_title)) },
            text = { Text(stringResource(R.string.settings_deletion_shared_text)) },
            confirmButton = {
                TextButton(onClick = {
                    deleteOwnedShops = true
                    onDismissChoice()
                    onRequestCode()
                    code = ""
                }) {
                    Text(stringResource(R.string.settings_deletion_delete_shops))
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    onDismissChoice()
                    onTransfer()
                }) { Text(stringResource(R.string.settings_home_transfer)) }
            },
        )
    }
}
