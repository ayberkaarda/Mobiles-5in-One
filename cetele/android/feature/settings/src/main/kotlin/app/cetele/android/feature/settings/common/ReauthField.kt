package app.cetele.android.feature.settings.common

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.feature.settings.R

@Composable
internal fun ReauthField(
    value: String,
    onValue: (String) -> Unit,
    enabled: Boolean,
) {
    OutlinedTextField(
        value = value,
        onValueChange = {
            if (it.length <= Limits.OTP_LENGTH &&
                it.all { character -> character in '0'..'9' }
            ) {
                onValue(it)
            }
        },
        label = { Text(stringResource(R.string.settings_deletion_code)) },
        enabled = enabled,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        visualTransformation = PasswordVisualTransformation(),
    )
}
