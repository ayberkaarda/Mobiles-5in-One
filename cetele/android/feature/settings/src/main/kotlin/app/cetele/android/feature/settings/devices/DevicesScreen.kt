package app.cetele.android.feature.settings.devices

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.account.validCode
import app.cetele.android.feature.settings.common.ReauthField
import app.cetele.android.feature.settings.common.SettingsErrorText
import app.cetele.android.feature.settings.common.SettingsPage

@Composable
@Suppress("LongMethod")
internal fun DevicesScreen(
    state: DevicesState,
    onSelect: (String) -> Unit,
    onRequestCode: () -> Unit,
    onSignOut: (String) -> Unit,
    onDismiss: () -> Unit,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
) {
    var code by remember(state.selectedId) { mutableStateOf("") }
    SettingsPage(stringResource(R.string.settings_devices_title), onBack) {
        Text(stringResource(R.string.settings_devices_explanation))
        CeteleButton(stringResource(R.string.settings_devices_refresh), onRefresh, enabled = !state.busy)
        if (state.devices.isEmpty() && !state.busy) Text(stringResource(R.string.settings_devices_empty))
        state.devices.forEach { device ->
            Text(device.model)
            Text(stringResource(R.string.settings_devices_version, device.appVersion))
            Text(stringResource(R.string.settings_devices_last_seen, device.lastSeenAt))
            if (device.current) Text(stringResource(R.string.settings_devices_current))
            val status =
                if (device.signedIn) R.string.settings_devices_signed_in else R.string.settings_devices_signed_out
            Text(stringResource(status))
            CeteleButton(
                stringResource(R.string.settings_devices_sign_out),
                { onSelect(device.id) },
                enabled = !state.busy && device.signedIn,
                style = ButtonStyle.Text,
            )
        }
        if (state.selectedId != null) {
            val selected = state.devices.find { it.id == state.selectedId }
            Text(selected?.model ?: stringResource(R.string.settings_devices_unknown_model))
            if (selected?.current == true) Text(stringResource(R.string.settings_devices_current))
            Text(stringResource(R.string.settings_devices_confirmation))
            CeteleButton(stringResource(R.string.settings_deletion_send_code), {
                code = ""
                onRequestCode()
            }, enabled = !state.busy)
            if (state.codeSent) {
                ReauthField(code, { code = it }, !state.busy)
                CeteleButton(stringResource(R.string.settings_devices_sign_out), {
                    onSignOut(code)
                    code = ""
                }, enabled = !state.busy && validCode(code))
            }
            CeteleButton(stringResource(R.string.settings_devices_cancel), onDismiss, enabled = !state.busy)
        }
        SettingsErrorText(state.error)
    }
}
