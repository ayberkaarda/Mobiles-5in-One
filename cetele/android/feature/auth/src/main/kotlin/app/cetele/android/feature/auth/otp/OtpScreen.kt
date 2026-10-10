package app.cetele.android.feature.auth.otp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.domain.format.PhoneFormat
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.feature.auth.R
import app.cetele.android.feature.auth.common.AuthErrorText
import app.cetele.android.feature.auth.common.AuthPage

@Composable
fun OtpScreen(
    state: OtpState,
    onCode: (String) -> Unit,
    onResend: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var code by remember(state.attempt) { mutableStateOf("") }
    val label = stringResource(R.string.auth_otp_code)
    val emptyDigit = stringResource(R.string.auth_otp_empty_digit)
    AuthPage(stringResource(R.string.auth_otp_title), modifier, onBack) {
        Text(stringResource(R.string.auth_otp_sent, PhoneFormat.masked(state.phone)))
        BasicTextField(
            value = code,
            onValueChange = { value ->
                if (value.length <= Limits.OTP_LENGTH && value.all { it in '0'..'9' }) {
                    code = value
                    if (value.length == Limits.OTP_LENGTH) onCode(value)
                }
            },
            modifier = Modifier.semantics { contentDescription = label },
            enabled = !state.loading && state.destination == null && state.retrySeconds == 0,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            singleLine = true,
            decorationBox = { input ->
                Box {
                    Row(horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small)) {
                        repeat(Limits.OTP_LENGTH) { index ->
                            Surface(
                                modifier = Modifier.weight(1f).heightIn(min = CeteleSpacing.touchTarget),
                                shape = MaterialTheme.shapes.small,
                                tonalElevation = CeteleSpacing.extraSmall,
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        code.getOrNull(index)?.toString() ?: emptyDigit,
                                        style = MaterialTheme.typography.titleLarge,
                                    )
                                }
                            }
                        }
                    }
                    Box(Modifier.padding(CeteleSpacing.small)) { input() }
                }
            },
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = Color.Transparent),
        )
        if (state.retrySeconds > 0) {
            Text(stringResource(R.string.auth_phone_retry, state.retrySeconds))
        } else {
            AuthErrorText(state.error)
        }
        if (state.resendSeconds > 0) Text(stringResource(R.string.auth_otp_resend_wait, state.resendSeconds))
        CeteleButton(
            stringResource(R.string.auth_otp_resend),
            onResend,
            enabled = state.resendSeconds == 0,
            loading = state.loading,
        )
    }
}
