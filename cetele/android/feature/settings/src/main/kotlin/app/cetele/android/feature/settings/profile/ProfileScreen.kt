package app.cetele.android.feature.settings.profile

import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.common.SettingsErrorText
import app.cetele.android.feature.settings.common.SettingsPage

@Composable
internal fun ProfileScreen(
    state: ProfileState,
    onName: (String) -> Unit,
    onSave: () -> Unit,
    onBack: () -> Unit,
) {
    SettingsPage(stringResource(R.string.settings_home_profile), onBack) {
        Text(state.phone)
        OutlinedTextField(
            value = state.name,
            onValueChange = onName,
            label = { Text(stringResource(R.string.settings_profile_name)) },
            enabled = !state.busy,
            singleLine = true,
            isError = state.invalidName,
        )
        if (state.invalidName) Text(stringResource(R.string.settings_profile_invalid_name))
        CeteleButton(stringResource(R.string.settings_common_save), onSave, loading = state.busy)
        if (state.saved) Text(stringResource(R.string.settings_common_saved))
        SettingsErrorText(state.error)
    }
}
