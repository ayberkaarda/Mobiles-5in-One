package app.cetele.android.feature.settings.shop

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.account.validCode
import app.cetele.android.feature.settings.common.ReauthField
import app.cetele.android.feature.settings.common.SettingsErrorText
import app.cetele.android.feature.settings.common.SettingsPage

@Composable
internal fun ShopDeletionScreen(
    state: ShopDeletionState,
    onRequestCode: () -> Unit,
    onDelete: (String) -> Unit,
    onCancel: () -> Unit,
    onBack: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    SettingsPage(stringResource(R.string.settings_home_shop_deletion), onBack) {
        Text(stringResource(R.string.settings_deletion_explanation))
        Text(stringResource(R.string.settings_deletion_shop_explanation))
        if (state.receipt != null) {
            Text(stringResource(R.string.settings_deletion_scheduled))
            CeteleButton(stringResource(R.string.settings_home_cancel_deletion), onCancel, enabled = !state.busy)
        } else {
            CeteleButton(stringResource(R.string.settings_deletion_send_code), {
                code = ""
                onRequestCode()
            }, enabled = !state.busy)
            if (state.codeSent) {
                ReauthField(code, { code = it }, !state.busy)
                CeteleButton(
                    stringResource(R.string.settings_home_shop_deletion),
                    {
                        onDelete(code)
                        code = ""
                    },
                    enabled =
                        !state.busy && validCode(code),
                )
            }
        }
        if (state.receipt == null && state.error?.code == "shop.deletion_pending") {
            CeteleButton(stringResource(R.string.settings_home_cancel_deletion), onCancel, enabled = !state.busy)
        }
        SettingsErrorText(state.error)
    }
}
