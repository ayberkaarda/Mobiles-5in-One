package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.VisualTransformation
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme

/** A field on Kâğıt with a Kurşun outline (the control boundary) and Defter Lacivert when focused. */
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
    leadingIcon: ImageVector? = null,
) {
    val colors = CeteleTheme.colors
    val supportingCopy = error ?: supporting
    val supportingContent: (@Composable () -> Unit)? = supportingCopy?.let { copy -> { Text(copy) } }
    val prefixContent: (@Composable () -> Unit)? = prefix?.let { copy -> { Text(copy) } }
    val leadingContent: (@Composable () -> Unit)? =
        leadingIcon?.let { icon -> { Icon(icon, contentDescription = null) } }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = modifier.heightIn(min = CeteleSpacing.touchTarget),
        isError = error != null,
        supportingText = supportingContent,
        prefix = prefixContent,
        leadingIcon = leadingContent,
        keyboardOptions = keyboard,
        visualTransformation = visualTransformation,
        singleLine = singleLine,
        enabled = enabled,
        textStyle = CeteleTextStyles.body,
        shape = MaterialTheme.shapes.small,
        colors =
            OutlinedTextFieldDefaults.colors(
                focusedContainerColor = colors.surface,
                unfocusedContainerColor = colors.surface,
                disabledContainerColor = colors.surfaceSunken,
                errorContainerColor = colors.surface,
                focusedBorderColor = colors.primary,
                unfocusedBorderColor = colors.borderStrong,
                focusedLabelColor = colors.primaryText,
                unfocusedLabelColor = colors.textMuted,
                focusedLeadingIconColor = colors.primaryText,
                unfocusedLeadingIconColor = colors.textMuted,
                cursorColor = colors.primary,
                errorBorderColor = colors.error,
                errorLabelColor = colors.errorText,
                errorSupportingTextColor = colors.errorText,
                focusedSupportingTextColor = colors.textMuted,
                unfocusedSupportingTextColor = colors.textMuted,
            ),
    )
}
