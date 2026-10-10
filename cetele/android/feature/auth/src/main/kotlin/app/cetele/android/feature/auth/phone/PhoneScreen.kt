package app.cetele.android.feature.auth.phone

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.PhoneTextField
import app.cetele.android.feature.auth.R
import app.cetele.android.feature.auth.common.AuthErrorText
import app.cetele.android.feature.auth.common.AuthPage

@Composable
fun PhoneScreen(
    state: PhoneState,
    onPhoneChange: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uri = LocalUriHandler.current
    AuthPage(stringResource(R.string.auth_phone_title), modifier) {
        PhoneTextField(
            state.phone,
            onPhoneChange,
            label = stringResource(R.string.auth_phone_number),
            enabled = !state.loading,
        )
        Text(stringResource(R.string.auth_phone_consent))
        val privacyUrl = stringResource(R.string.auth_phone_privacy_url)
        CeteleButton(
            stringResource(R.string.auth_phone_privacy),
            { uri.openUri(privacyUrl) },
            style = ButtonStyle.Text,
        )
        if (state.retrySeconds > 0) {
            Text(stringResource(R.string.auth_phone_retry, state.retrySeconds))
        } else {
            AuthErrorText(state.error)
        }
        CeteleButton(
            stringResource(R.string.auth_phone_send),
            onSend,
            enabled = state.retrySeconds == 0,
            loading = state.loading,
        )
    }
}
