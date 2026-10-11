package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfirmSheet(
    title: String,
    text: String,
    confirmText: String,
    destructive: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = modifier,
        shape = MaterialTheme.shapes.large.copy(bottomStart = CornerSize(0), bottomEnd = CornerSize(0)),
        containerColor = CeteleTheme.colors.surfaceRaised,
        scrimColor = CeteleTheme.colors.overlay,
    ) {
        Column(
            modifier =
                Modifier.fillMaxWidth().padding(
                    start = CeteleSpacing.extraLarge,
                    end = CeteleSpacing.extraLarge,
                    bottom = CeteleSpacing.extraLarge,
                ),
            verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
        ) {
            Text(title, modifier = Modifier.semantics { heading() }, style = CeteleTextStyles.title)
            Text(text, style = CeteleTextStyles.body, color = CeteleTheme.colors.textMuted)
            if (destructive) {
                Button(
                    onClick = onConfirm,
                    modifier = Modifier.fillMaxWidth().heightIn(min = CeteleSpacing.buttonHeight),
                    shape = MaterialTheme.shapes.small,
                    enabled = !loading,
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = CeteleTheme.colors.error,
                            contentColor = CeteleTheme.colors.onError,
                        ),
                ) {
                    Text(
                        if (loading) stringResource(R.string.designsystem_button_loading) else confirmText,
                        style = CeteleTextStyles.label,
                    )
                }
            } else {
                CeteleButton(confirmText, onConfirm, modifier = Modifier.fillMaxWidth(), loading = loading)
            }
            CeteleButton(
                text = stringResource(R.string.action_cancel),
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth(),
                style = ButtonStyle.Text,
                enabled = !loading,
            )
        }
    }
}
