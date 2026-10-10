package app.cetele.android.feature.settings.about

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.common.SettingsPage

@Composable
internal fun AboutScreen(
    version: String,
    onBack: () -> Unit,
) {
    SettingsPage(stringResource(R.string.settings_home_about), onBack) {
        Text(stringResource(R.string.settings_about_version, version))
        Text(stringResource(R.string.settings_about_licences))
        Text(stringResource(R.string.settings_about_inter))
        Text(stringResource(R.string.settings_about_manrope))
        Text(stringResource(R.string.settings_about_ofl))
    }
}
