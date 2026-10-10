package app.cetele.android.feature.settings.lock

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import app.cetele.android.core.designsystem.component.ButtonStyle
import app.cetele.android.core.designsystem.component.CeteleButton
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.feature.settings.R
import app.cetele.android.feature.settings.common.SettingsPage

@Composable
internal fun LockSettingsScreen(
    state: LockSettingsState,
    available: Boolean,
    onSave: (String, String, String, Boolean, Int, Boolean) -> Unit,
    onBack: () -> Unit,
) {
    var oldPin by remember { mutableStateOf("") }
    var newPin by remember { mutableStateOf("") }
    var repeat by remember { mutableStateOf("") }
    var biometric by remember(state.settings.biometricUnlockEnabled) {
        mutableStateOf(state.settings.biometricUnlockEnabled)
    }
    var timeout by remember(state.settings.lockTimeoutSeconds) { mutableStateOf(state.settings.lockTimeoutSeconds) }
    val biometricLabel = stringResource(R.string.settings_lock_biometric)
    SettingsPage(stringResource(R.string.settings_home_lock), onBack) {
        Text(stringResource(R.string.settings_lock_explanation))
        PinField(oldPin, { oldPin = it }, R.string.settings_lock_old_pin, !state.busy)
        PinField(newPin, { newPin = it }, R.string.settings_lock_new_pin, !state.busy)
        PinField(repeat, { repeat = it }, R.string.settings_lock_repeat_pin, !state.busy)
        Row {
            Text(biometricLabel)
            Switch(
                checked = biometric,
                onCheckedChange = { biometric = it },
                enabled =
                    !state.busy && (available || biometric),
                modifier = Modifier.semantics { contentDescription = biometricLabel },
            )
        }
        if (!available) Text(stringResource(R.string.settings_lock_unavailable))
        Text(stringResource(R.string.settings_lock_timeout))
        LockSettingsViewModel.TIMEOUTS.forEach { seconds ->
            CeteleButton(
                stringResource(R.string.settings_lock_minutes, seconds / SECONDS_PER_MINUTE),
                { timeout = seconds },
                enabled =
                    !state.busy && seconds != timeout,
                style = ButtonStyle.Text,
            )
        }
        CeteleButton(stringResource(R.string.settings_common_save), {
            onSave(oldPin, newPin, repeat, biometric, timeout, available)
            oldPin = ""
            newPin = ""
            repeat = ""
        }, loading = state.busy)
        state.error?.let { error ->
            Text(
                stringResource(
                    when (error) {
                        LockSettingsError.WRONG_PIN -> R.string.settings_lock_wrong_pin
                        LockSettingsError.DELAYED -> R.string.settings_lock_delayed
                        LockSettingsError.INVALID_PIN -> R.string.settings_lock_invalid_pin
                        LockSettingsError.MISMATCH -> R.string.settings_lock_mismatch
                        LockSettingsError.BIOMETRIC_UNAVAILABLE -> R.string.settings_lock_unavailable
                    },
                ),
            )
        }
        if (state.saved) Text(stringResource(R.string.settings_common_saved))
    }
}

@Composable
private fun PinField(
    value: String,
    onValue: (String) -> Unit,
    label: Int,
    enabled: Boolean,
) {
    OutlinedTextField(
        value = value,
        onValueChange = {
            if (it.length <= Limits.PIN_LENGTH &&
                it.all { character -> character in '0'..'9' }
            ) {
                onValue(it)
            }
        },
        label = { Text(stringResource(label)) },
        singleLine = true,
        enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        visualTransformation = PasswordVisualTransformation(),
    )
}

private const val SECONDS_PER_MINUTE = 60
