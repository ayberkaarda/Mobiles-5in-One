package app.cetele.android.feature.settings.shop

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.domain.format.PhoneFormat
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.account.validCode
import app.cetele.android.feature.settings.common.ReauthField
import app.cetele.android.feature.settings.common.SettingsErrorText
import app.cetele.android.feature.settings.common.SettingsPage

@Composable
internal fun OwnershipTransferScreen(
    state: OwnershipTransferState,
    onSelect: (String) -> Unit,
    onRequestCode: () -> Unit,
    onTransfer: (String) -> Unit,
    onBack: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    SettingsPage(stringResource(R.string.settings_home_transfer), onBack) {
        Text(stringResource(R.string.settings_transfer_explanation))
        if (state.receipt != null) {
            Text(stringResource(R.string.settings_transfer_done))
            CeteleButton(stringResource(R.string.settings_common_back), onBack)
        } else {
            if (state.members.isEmpty() && !state.busy) Text(stringResource(R.string.settings_transfer_no_staff))
            state.members.forEach { member ->
                CeteleButton(
                    member.displayName ?: PhoneFormat.masked(member.phone),
                    { onSelect(member.userId) },
                    style = if (member.userId == state.selectedUserId) ButtonStyle.Primary else ButtonStyle.Outlined,
                    enabled = !state.busy,
                )
            }
            CeteleButton(
                stringResource(R.string.settings_deletion_send_code),
                {
                    code = ""
                    onRequestCode()
                },
                enabled =
                    !state.busy && state.selectedUserId != null,
            )
            if (state.codeSent) {
                ReauthField(code, { code = it }, !state.busy)
                CeteleButton(
                    stringResource(R.string.settings_home_transfer),
                    {
                        onTransfer(code)
                        code = ""
                    },
                    enabled =
                        !state.busy && validCode(code) && state.selectedUserId != null,
                )
            }
        }
        SettingsErrorText(state.error)
    }
}
