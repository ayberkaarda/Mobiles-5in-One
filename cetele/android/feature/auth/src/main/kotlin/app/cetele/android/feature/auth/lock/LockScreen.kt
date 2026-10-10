package app.cetele.android.feature.auth.lock

import androidx.biometric.BiometricManager
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.designsystem.component.ConfirmSheet
import app.cetele.android.core.designsystem.component.PinPad
import app.cetele.android.feature.auth.R
import app.cetele.android.feature.auth.common.AuthPage

@Composable
fun LockScreen(
    state: LockScreenState,
    onPin: (String) -> Unit,
    onBiometric: () -> Unit,
    onForgotPin: () -> Unit,
    onConfirmSignOut: () -> Unit,
    onDismissSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AuthPage(stringResource(R.string.auth_lock_title), modifier) {
        PinPad(
            onComplete = onPin,
            subtitle = stringResource(R.string.auth_lock_enter),
            error = if (state.wrongPin) stringResource(R.string.auth_lock_wrong) else null,
            enabled = !state.loading && state.delaySeconds == 0 && !state.unlocked,
            resetKey = state.attempt,
        )
        if (state.delaySeconds > 0) Text(stringResource(R.string.auth_lock_delay, state.delaySeconds))
        if (state.biometricError) Text(stringResource(R.string.auth_lock_biometric_unavailable))
        if (state.biometricEnabled) {
            CeteleButton(
                stringResource(R.string.auth_lock_biometric),
                onBiometric,
                enabled =
                    !state.loading && !state.unlocked,
            )
        }
        CeteleButton(
            stringResource(R.string.auth_lock_forgot),
            onForgotPin,
            style = ButtonStyle.Text,
            enabled = !state.loading,
        )
    }
    if (state.confirmSignOut) {
        ConfirmSheet(
            title = stringResource(R.string.auth_lock_forgot),
            text =
                stringResource(
                    if (state.confirmPending) R.string.auth_lock_pending else R.string.auth_lock_forgot_explanation,
                    state.pendingCount,
                ),
            confirmText = stringResource(R.string.auth_lock_signout),
            destructive = true,
            onConfirm = onConfirmSignOut,
            onDismiss = onDismissSignOut,
            loading = state.loading,
        )
    }
}

@Composable
fun rememberBiometricUnlockAction(
    onSuccess: () -> Unit,
    onUnavailable: () -> Unit,
): () -> Unit {
    val context = LocalContext.current
    val title = stringResource(R.string.auth_lock_title)
    val fallback = stringResource(R.string.auth_lock_pin_fallback)
    return {
        val activity = context.fragmentActivity()
        val available =
            BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
                BiometricManager.BIOMETRIC_SUCCESS
        if (activity != null &&
            available
        ) {
            showBiometricUnlock(activity, title, fallback, onSuccess, onUnavailable)
        } else {
            onUnavailable()
        }
    }
}
