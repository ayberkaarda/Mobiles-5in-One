package app.cetele.android.feature.auth.pinsetup

import androidx.biometric.BiometricManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.component.PinPad
import app.cetele.android.feature.auth.R
import app.cetele.android.feature.auth.common.AuthPage

@Composable
fun PinSetupScreen(
    state: PinSetupState,
    onPin: (String, Boolean) -> Unit,
    onBiometricChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val available =
        remember(context) {
            BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
                BiometricManager.BIOMETRIC_SUCCESS
        }
    AuthPage(stringResource(R.string.auth_pinsetup_title), modifier) {
        Text(stringResource(R.string.auth_pinsetup_explanation))
        PinPad(
            onComplete = { onPin(it, available) },
            subtitle =
                stringResource(
                    if (state.repeating) R.string.auth_pinsetup_repeat else R.string.auth_pinsetup_enter,
                ),
            error = if (state.mismatch) stringResource(R.string.auth_pinsetup_mismatch) else null,
            enabled = !state.loading && !state.complete,
            resetKey = state.attempt,
        )
        if (available) {
            val label = stringResource(R.string.auth_pinsetup_biometric)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
            ) {
                Text(label, modifier = Modifier.weight(1f))
                Switch(
                    checked = state.biometricEnabled,
                    onCheckedChange = onBiometricChange,
                    enabled = !state.loading,
                    modifier =
                        Modifier.semantics {
                            contentDescription =
                                label
                        },
                )
            }
        }
    }
}
