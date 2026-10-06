@file:Suppress("MatchingDeclarationName")

package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R

enum class ButtonStyle {
    Primary,
    Tonal,
    Outlined,
    Text,
}

@Composable
fun CeteleButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: ButtonStyle = ButtonStyle.Primary,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    val loadingText = stringResource(R.string.designsystem_button_loading)
    val target =
        modifier.heightIn(min = CeteleSpacing.touchTarget).semantics {
            if (loading) {
                contentDescription = text
                stateDescription = loadingText
            }
        }
    val content: @Composable RowScope.() -> Unit = { ButtonContent(text, loading) }
    when (style) {
        ButtonStyle.Primary -> {
            Button(
                onClick = onClick,
                modifier = target,
                enabled = enabled && !loading,
                content = content,
            )
        }

        ButtonStyle.Tonal -> {
            Button(
                onClick = onClick,
                modifier = target,
                enabled = enabled && !loading,
                colors =
                    ButtonDefaults.buttonColors(
                        containerColor = CeteleTheme.colors.secondary,
                        contentColor = CeteleTheme.colors.onSecondary,
                    ),
                content = content,
            )
        }

        ButtonStyle.Outlined -> {
            OutlinedButton(
                onClick = onClick,
                modifier = target,
                enabled = enabled && !loading,
                content = content,
            )
        }

        ButtonStyle.Text -> {
            TextButton(
                onClick = onClick,
                modifier = target,
                enabled = enabled && !loading,
                content = content,
            )
        }
    }
}

@Composable
private fun ButtonContent(
    text: String,
    loading: Boolean,
) {
    if (loading) {
        CircularProgressIndicator(
            modifier = Modifier.size(CeteleSpacing.extraLarge),
            color = androidx.compose.material3.LocalContentColor.current,
        )
    } else {
        Text(text)
    }
}
