package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.VisualTransformation
import app.cetele.android.core.designsystem.CeteleSpacing

@Composable
fun CeteleTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    keyboard: KeyboardOptions = KeyboardOptions.Default,
    supporting: String? = null,
    prefix: String? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val supportingCopy = error ?: supporting
    val supportingContent: (@Composable () -> Unit)? = supportingCopy?.let { copy -> { Text(copy) } }
    val prefixContent: (@Composable () -> Unit)? = prefix?.let { copy -> { Text(copy) } }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = modifier.heightIn(min = CeteleSpacing.touchTarget),
        isError = error != null,
        supportingText = supportingContent,
        prefix = prefixContent,
        keyboardOptions = keyboard,
        visualTransformation = visualTransformation,
        singleLine = singleLine,
        enabled = enabled,
    )
}
